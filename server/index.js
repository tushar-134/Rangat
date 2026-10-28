import 'dotenv/config'
import crypto from 'node:crypto'
import http from 'node:http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { Server } from 'socket.io'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { AuditLog, Category, Dish, Order, ServiceRequest, Table, User } from './models.js'
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
const orderSchema = z.object({ table: z.string().min(1).max(40), tableToken: z.string().max(2000).optional(), items: z.array(z.object({ dishId: z.string().min(1), quantity: z.number().int().min(1).max(30), option: z.string().optional(), note: z.string().max(180).optional() })).min(1).max(30) })
const allowedTransitions = { Received: ['Preparing', 'Rejected', 'Cancelled'], Preparing: ['Ready', 'Cancelled'], Ready: ['Served'], Served: [], Rejected: [], Cancelled: [] }
let demoOrders = []
let isConnected = false
let mongoConnection = Promise.resolve()

if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('<username>')) {
  mongoConnection = mongoose.connect(process.env.MONGODB_URI).then(() => { isConnected = true; console.log('Connected to MongoDB Atlas') }).catch(error => { console.error('MongoDB connection failed:', error.name); throw error })
}

app.use('/api', async (_req, res, next) => {
  if (!demo && !isConnected) {
    try { await mongoConnection } catch { return res.status(503).json({ error: 'Database unavailable' }) }
    if (!isConnected) return res.status(503).json({ error: 'Database unavailable' })
  }
  next()
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: isConnected ? 'connected' : 'demo', demoMode: demo }))

const staffSchema = z.object({ email: z.string().email().max(180), password: z.string().min(1).max(200) })
app.post('/api/auth/login', async (req, res) => {
  const parsed = staffSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  if (!isConnected || !process.env.JWT_SECRET) return res.status(503).json({ error: 'Staff login is not configured.' })
  try {
    const user = await User.findOne({ email: parsed.data.email.toLowerCase(), active: true })
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
    const token = jwt.sign({ sub: String(user._id), restaurantId: String(user.restaurantId), role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '12h', issuer: 'rangat' })
    return res.json({ token, user: { name: user.name, role: user.role } })
  } catch (error) { console.error('Staff sign-in failed:', error.name); return res.status(500).json({ error: 'Could not sign in.' }) }
})

function requireStaff(req, res, next) {
  const token = req.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: 'Staff sign-in required.' })
  try {
    req.staff = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'rangat' })
    return next()
  } catch { return res.status(401).json({ error: 'Staff session expired. Sign in again.' })
  }
}

// Local preview fallback: no customer/table data is written to the database.
app.get('/api/menu', async (_req, res) => {
  if (!isConnected) return res.json({ categories: previewCategories, dishes: previewDishes })
  const [categories, dishes] = await Promise.all([Category.find({ active: true }).sort({ sortOrder: 1 }).lean(), Dish.find({ available: true }).lean()])
  res.json({ categories, dishes })
})

app.get('/api/staff/orders', requireStaff, async (req, res) => {
  if (!isConnected) return res.json(demoOrders)
  const orders = await Order.find({ restaurantId: req.staff.restaurantId }).sort({ createdAt: -1 }).limit(200).lean()
  res.json(orders)
})

app.get('/api/staff/tables/qr', requireStaff, async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'Table QR codes require the database.' })
  const count = Math.min(60, Math.max(1, Number.parseInt(req.query.count, 10) || 20))
  try {
    const labels = Array.from({ length: count }, (_, index) => String(index + 1))
    const tables = await Table.find({ restaurantId: req.staff.restaurantId, label: { $in: labels }, active: true }).select('label qrTokenHash').lean()
    const byLabel = new Map(tables.map(table => [table.label, table]))
    const result = []
    for (const label of labels) {
      const token = jwt.sign({ restaurantId: req.staff.restaurantId, table: label }, process.env.JWT_SECRET, { issuer: 'rangat', audience: 'rangat-table', noTimestamp: true })
      if (byLabel.get(label)?.qrTokenHash !== hash(token)) return res.status(409).json({ error: `Table ${label} is not configured. Run the database seed again.` })
      result.push({ table: label, token })
    }
    return res.json(result)
  } catch (error) { console.error('Could not load table QR codes:', error.name); return res.status(500).json({ error: 'Could not load table QR codes.' }) }
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
    if (!parsed.data.tableToken) return res.status(403).json({ error: 'Scan the table QR code to place an order.' })
    let qrClaims
    try { qrClaims = jwt.verify(parsed.data.tableToken, process.env.JWT_SECRET, { issuer: 'rangat', audience: 'rangat-table' }) } catch { return res.status(403).json({ error: 'Table QR is invalid or expired.' }) }
    if (qrClaims.table !== parsed.data.table) return res.status(403).json({ error: 'Table QR does not match this table.' })
    const table = await Table.findOne({ label: parsed.data.table, restaurantId: qrClaims.restaurantId, active: true, qrTokenHash: hash(parsed.data.tableToken) })
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

app.patch('/api/orders/:id/status', requireStaff, async (req, res) => {
  const { status } = req.body || {}
  if (!Object.hasOwn(allowedTransitions, status)) return res.status(400).json({ error: 'Unknown order status' })
  if (!isConnected) { const order = demoOrders.find(item => item.id === req.params.id || item.publicOrderId === req.params.id); if (!order) return res.status(404).json({ error: 'Order not found' }); if (!allowedTransitions[order.status].includes(status)) return res.status(409).json({ error: 'Invalid status transition' }); order.status = status; io.emit('order:updated', order); return res.json(order) }
  const order = await Order.findOne({ restaurantId: req.staff.restaurantId, $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { publicOrderId: req.params.id }] })
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (!allowedTransitions[order.status].includes(status)) return res.status(409).json({ error: `Cannot move ${order.status} to ${status}` })
  order.status = status; await order.save()
  await AuditLog.create({ restaurantId: order.restaurantId, action: `order.${status.toLowerCase()}`, entityType: 'order', entityId: String(order._id) })
  const result = order.toObject(); io.to(`restaurant:${order.restaurantId}`).emit('order:updated', result); io.to(`table:${order.tableId}`).emit('order:updated', result); res.json(result)
})

app.post('/api/service-requests', async (req, res) => {
  const schema = z.object({ table: z.string().min(1), tableToken: z.string().max(2000).optional(), type: z.enum(['waiter', 'bill']) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  if (!isConnected) {
    const request = { id: crypto.randomUUID(), status: 'open', createdAt: new Date().toISOString(), ...parsed.data }
    io.emit('service-request:created', request)
    return res.status(201).json(request)
  }
  if (!parsed.data.tableToken) return res.status(403).json({ error: 'Scan the table QR code to request service.' })
  let qrClaims
  try { qrClaims = jwt.verify(parsed.data.tableToken, process.env.JWT_SECRET, { issuer: 'rangat', audience: 'rangat-table' }) } catch { return res.status(403).json({ error: 'Invalid table QR.' }) }
  const table = await Table.findOne({ label: parsed.data.table, restaurantId: qrClaims.restaurantId, active: true, qrTokenHash: hash(parsed.data.tableToken) })
  if (!table || qrClaims.table !== parsed.data.table) return res.status(403).json({ error: 'Invalid table' })
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
if (!process.env.VERCEL) server.listen(PORT, () => console.log(`Table Service API listening on http://localhost:${PORT}`))

export default app
