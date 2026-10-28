import 'dotenv/config'
import crypto from 'node:crypto'
import http from 'node:http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { Server } from 'socket.io'
import { z } from 'zod'
import { AuditLog, Category, Dish, Order, ServiceRequest, Table } from './models.js'
import { categories as previewCategories, dishes as previewDishes } from '../src/data.js'

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true } })
const PORT = Number(process.env.PORT || 4000)
const demo = process.env.DEMO_MODE !== 'false'
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '50kb' }))

const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const orderSchema = z.object({ table: z.string().min(1).max(40), items: z.array(z.object({ dishId: z.string().min(1), quantity: z.number().int().min(1).max(30), option: z.string().optional(), note: z.string().max(180).optional() })).min(1).max(30) })
const allowedTransitions = { Received: ['Preparing', 'Rejected', 'Cancelled'], Preparing: ['Ready', 'Cancelled'], Ready: ['Served'], Served: [], Rejected: [], Cancelled: [] }
let demoOrders = []
let isConnected = false

if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('<username>')) {
  mongoose.connect(process.env.MONGODB_URI).then(() => { isConnected = true; console.log('Connected to MongoDB Atlas') }).catch(error => console.error('MongoDB connection failed:', error.message))
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: isConnected ? 'connected' : 'demo', demoMode: demo }))

// Local preview fallback: no customer/table data is written to the database.
app.get('/api/menu', async (_req, res) => {
  if (!isConnected) return res.json({ categories: previewCategories, dishes: previewDishes })
  const [categories, dishes] = await Promise.all([Category.find({ active: true }).sort({ sortOrder: 1 }).lean(), Dish.find({ available: true }).lean()])
  res.json({ categories, dishes })
})

app.get('/api/staff/orders', async (_req, res) => {
  if (!isConnected) return res.json(demoOrders)
  const orders = await Order.find().sort({ createdAt: -1 }).limit(200).lean()
  res.json(orders)
})

app.post('/api/orders', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order details', details: parsed.error.flatten() })
  const idempotencyKey = req.get('Idempotency-Key')
  try {
    if (!isConnected) {
      const menuById = new Map(previewDishes.map(dish => [dish.id, dish]))
      const items = parsed.data.items.map(item => {
        const dish = menuById.get(item.dishId)
        return dish ? { id: dish.id, dishId: dish.id, name: dish.name, quantity: item.quantity, price: dish.price, option: item.option || '', note: item.note || '' } : null
      })
      if (items.some(item => !item)) return res.status(409).json({ error: 'One or more dishes are unavailable. Refresh the menu and try again.' })
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const id = `OL-${crypto.randomInt(1000, 9999)}`
      const order = { id, publicOrderId: id, table: parsed.data.table, status: 'Received', items, total, subtotal: total, createdAt: new Date().toISOString() }
      demoOrders.unshift(order)
      io.emit('order:created', order)
      return res.status(201).json(order)
    }
    const table = await Table.findOne({ label: parsed.data.table, active: true })
    if (!table) return res.status(403).json({ error: 'Table QR is invalid or inactive' })
    if (idempotencyKey) { const prior = await Order.findOne({ idempotencyKey }); if (prior) return res.json(prior) }
    const ids = parsed.data.items.map(item => item.dishId)
    const dishes = await Dish.find({ _id: { $in: ids }, restaurantId: table.restaurantId, available: true }).lean()
    const byId = new Map(dishes.map(d => [String(d._id), d]))
    if (dishes.length !== new Set(ids).size) return res.status(409).json({ error: 'One or more dishes are unavailable. Refresh the menu and try again.' })
    const items = parsed.data.items.map(item => { const dish = byId.get(item.dishId); return { dishId: dish._id, dishKey: String(dish._id), name: dish.name, quantity: item.quantity, unitPrice: dish.price, option: item.option || '', note: item.note || '' } })
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    const customerToken = crypto.randomBytes(32).toString('hex')
    const order = await Order.create({ restaurantId: table.restaurantId, tableId: table._id, tableLabel: table.label, publicOrderId: `OH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerTokenHash: hash(customerToken), items, subtotal: total, total, idempotencyKey })
    await AuditLog.create({ restaurantId: table.restaurantId, action: 'order.created', entityType: 'order', entityId: String(order._id), metadata: { table: table.label } })
    const result = order.toObject(); result.customerToken = customerToken
    io.to(`restaurant:${table.restaurantId}`).emit('order:created', result)
    io.to(`table:${table._id}`).emit('order:updated', result)
    res.status(201).json(result)
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not place order' }) }
})

app.get('/api/orders/:id', async (req, res) => {
  if (!isConnected) { const order = demoOrders.find(item => item.id === req.params.id || item.publicOrderId === req.params.id); return order ? res.json(order) : res.status(404).json({ error: 'Order not found' }) }
  const token = req.get('X-Order-Token')
  if (!token) return res.status(401).json({ error: 'Order access token required' })
  const order = await Order.findOne({ publicOrderId: req.params.id, customerTokenHash: hash(token) }).lean()
  return order ? res.json(order) : res.status(404).json({ error: 'Order not found' })
})

app.patch('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body || {}
  if (!Object.hasOwn(allowedTransitions, status)) return res.status(400).json({ error: 'Unknown order status' })
  if (!isConnected) { const order = demoOrders.find(item => item.id === req.params.id || item.publicOrderId === req.params.id); if (!order) return res.status(404).json({ error: 'Order not found' }); if (!allowedTransitions[order.status].includes(status)) return res.status(409).json({ error: 'Invalid status transition' }); order.status = status; io.emit('order:updated', order); return res.json(order) }
  // TODO: protect this staff route with authenticated sessions and role checks before production use.
  const order = await Order.findOne({ $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { publicOrderId: req.params.id }] })
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (!allowedTransitions[order.status].includes(status)) return res.status(409).json({ error: `Cannot move ${order.status} to ${status}` })
  order.status = status; await order.save()
  await AuditLog.create({ restaurantId: order.restaurantId, action: `order.${status.toLowerCase()}`, entityType: 'order', entityId: String(order._id) })
  const result = order.toObject(); io.to(`restaurant:${order.restaurantId}`).emit('order:updated', result); io.to(`table:${order.tableId}`).emit('order:updated', result); res.json(result)
})

app.post('/api/service-requests', async (req, res) => {
  const schema = z.object({ table: z.string().min(1), type: z.enum(['waiter', 'bill']) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  if (!isConnected) {
    const request = { id: crypto.randomUUID(), status: 'open', createdAt: new Date().toISOString(), ...parsed.data }
    io.emit('service-request:created', request)
    return res.status(201).json(request)
  }
  const table = await Table.findOne({ label: parsed.data.table, active: true })
  if (!table) return res.status(403).json({ error: 'Invalid table' })
  const request = await ServiceRequest.create({ restaurantId: table.restaurantId, tableId: table._id, type: parsed.data.type })
  io.to(`restaurant:${table.restaurantId}`).emit('service-request:created', request)
  res.status(201).json(request)
})

io.on('connection', socket => {
  socket.on('order:subscribe', async ({ orderId, token } = {}) => {
    if (!isConnected || !orderId || !token) return
    const order = await Order.findOne({ publicOrderId: orderId, customerTokenHash: hash(token) }).select('_id tableId').lean()
    if (order) socket.join(`table:${order.tableId}`)
  })
  // Restaurant room membership requires staff authentication; never accept a raw restaurant ID here.
})

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error' }) })
server.listen(PORT, () => console.log(`Table Service API listening on http://localhost:${PORT}`))
