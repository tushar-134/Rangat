export const restaurant = {
  name: 'Rangat Café & Restaurant',
  subtitle: 'A taste of Nawalgarh · Rajasthani hospitality',
  table: typeof window === 'undefined' ? '12' : new URLSearchParams(window.location.search).get('table') || '12',
  tableToken: typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') || '',
  location: 'Nawalgarh, Rajasthan',
  currency: '₹',
}

// Demo menu until the restaurant shares its approved menu, prices and photography.
export const categories = ['All', 'Rajasthani Specials', 'Café Bites', 'Beverages']
export const dishes = [
  { id: 'dal-baati-churma', name: 'Dal Baati Churma', category: 'Rajasthani Specials', price: 320, description: 'Slow-cooked panchmel dal, golden baati, churma and a spoon of ghee.', ingredients: 'Lentils, wheat, ghee, jaggery, spices', allergens: ['Gluten', 'Dairy'], tags: ['Vegetarian'], spicy: false, time: '25 min', image: 'photo-1547592180-85f173990554' },
  { id: 'gatte-ki-sabzi', name: 'Gatte ki Sabzi', category: 'Rajasthani Specials', price: 280, description: 'Gram flour dumplings simmered in a warmly spiced yoghurt gravy.', ingredients: 'Gram flour, yoghurt, spices, ghee', allergens: ['Dairy'], tags: ['Vegetarian'], spicy: true, time: '20 min', image: 'photo-1567188040759-fb8a883dc6d8' },
  { id: 'ker-sangri', name: 'Ker Sangri', category: 'Rajasthani Specials', price: 310, description: 'Desert berries and beans tossed with house-ground Marwari masala.', ingredients: 'Ker berries, sangri beans, mustard oil, spices', allergens: [], tags: ['Vegan', 'Vegetarian'], spicy: true, time: '18 min', image: 'photo-1512621776951-a57141f2eefd' },
  { id: 'laal-maas', name: 'Laal Maas', category: 'Rajasthani Specials', price: 480, description: 'A rich, slow-cooked Rajasthani curry with Mathania chillies.', ingredients: 'Mutton, yoghurt, Mathania chilli, garlic', allergens: ['Dairy'], tags: ['Gluten-free'], spicy: true, time: '35 min', image: 'photo-1534939561126-855b8675edd7' },
  { id: 'mirchi-vada', name: 'Jodhpuri Mirchi Vada', category: 'Café Bites', price: 180, description: 'Chilli peppers filled with spiced potato, dipped in gram flour and fried crisp.', ingredients: 'Green chilli, potato, gram flour, spices', allergens: [], tags: ['Vegan', 'Vegetarian'], spicy: true, time: '12 min', image: 'photo-1601050690597-df0568f70950' },
  { id: 'pyaaz-kachori', name: 'Pyaaz Kachori', category: 'Café Bites', price: 160, description: 'Flaky pastry with a tangy onion filling, served with chutneys.', ingredients: 'Wheat flour, onion, spices, chutney', allergens: ['Gluten'], tags: ['Vegetarian'], spicy: true, time: '10 min', image: 'photo-1626777552726-4a6b54c97e46' },
  { id: 'kesariya-chai', name: 'Kesariya Chai', category: 'Beverages', price: 110, description: 'Slow-brewed tea with saffron, cardamom and a touch of warmth.', ingredients: 'Tea, milk, saffron, cardamom', allergens: ['Dairy'], tags: ['Vegetarian'], spicy: false, time: '6 min', image: 'photo-1571934811356-5cc061b6821f' },
  { id: 'chaas', name: 'Masala Chaas', category: 'Beverages', price: 90, description: 'Cool, salted buttermilk with roasted cumin and fresh mint.', ingredients: 'Yoghurt, cumin, mint, black salt', allergens: ['Dairy'], tags: ['Vegetarian'], spicy: false, time: '4 min', image: 'photo-1556679343-c7306c1976bc' },
]
