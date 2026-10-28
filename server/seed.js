import 'dotenv/config'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { Restaurant, Category, Dish, Table } from './models.js'
import { categories, dishes } from '../src/data.js'

const hash = value => crypto.createHash('sha256').update(value).digest('hex')

if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<username>')) {
  console.error('MONGODB_URI is not configured.')
  process.exit(1)
}

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  const restaurant = await Restaurant.findOneAndUpdate(
    { slug: 'rangat-nawalgarh' },
    { $setOnInsert: { name: 'Rangat Café & Restaurant', slug: 'rangat-nawalgarh', timezone: 'Asia/Kolkata', currency: 'INR' } },
    { upsert: true, new: true },
  )

  const categoryIds = new Map()
  for (const [index, name] of categories.filter(name => name !== 'All').entries()) {
    const category = await Category.findOneAndUpdate(
      { restaurantId: restaurant._id, name },
      { $setOnInsert: { restaurantId: restaurant._id, name, sortOrder: index } },
      { upsert: true, new: true },
    )
    categoryIds.set(name, category._id)
  }

  for (const dish of dishes) {
    await Dish.findOneAndUpdate(
      { restaurantId: restaurant._id, name: dish.name },
      { $setOnInsert: {
        restaurantId: restaurant._id,
        categoryId: categoryIds.get(dish.category),
        name: dish.name,
        description: dish.description,
        imageUrl: `https://images.unsplash.com/${dish.image}?auto=format&fit=crop&w=840&q=82`,
        price: dish.price,
        ingredients: dish.ingredients.split(', '),
        allergens: dish.allergens,
        tags: dish.tags,
        spicy: dish.spicy,
        prepMinutes: Number.parseInt(dish.time, 10),
        available: true,
      } },
      { upsert: true, new: true },
    )
  }

  for (let number = 1; number <= 20; number += 1) {
    const token = crypto.randomBytes(32).toString('hex')
    await Table.updateOne(
      { restaurantId: restaurant._id, label: String(number) },
      { $setOnInsert: { restaurantId: restaurant._id, label: String(number), qrTokenHash: hash(token), active: true } },
      { upsert: true },
    )
  }

  const [categoryCount, dishCount, tableCount] = await Promise.all([
    Category.countDocuments({ restaurantId: restaurant._id, active: true }),
    Dish.countDocuments({ restaurantId: restaurant._id, available: true }),
    Table.countDocuments({ restaurantId: restaurant._id, active: true }),
  ])
  console.log(`Seed complete for ${restaurant.name}: ${categoryCount} categories, ${dishCount} sample dishes, ${tableCount} tables.`)
} catch (error) {
  console.error('Database seed failed:', error.name)
  process.exitCode = 1
} finally {
  await mongoose.disconnect().catch(() => {})
}
