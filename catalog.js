// Demo catalogue — fictional brands only (no real company data).
// price = selling price per piece (₹); caseQty = pieces per case.
export const FAMILIES = [
  { key: 'CG', name: 'Coco Gold Coconut Oil', short: 'Coco Gold',
    aliases: ['coco gold', 'cocogold', 'coconut oil', 'coconut', 'nariyal tel', 'nariyal', 'नारियल तेल', 'नारियल', 'कोको गोल्ड'],
    variants: [
      { id: 'CG-100', size: '100 ml', key: '100ml', price: 45, caseQty: 72, def: true },
      { id: 'CG-200', size: '200 ml', key: '200ml', price: 85, caseQty: 48 },
      { id: 'CG-500', size: '500 ml', key: '500ml', price: 190, caseQty: 24 },
    ] },
  { key: 'AS', name: 'Amla Shine Hair Oil', short: 'Amla Shine',
    aliases: ['amla shine', 'amla', 'amla oil', 'hair oil', 'आंवला', 'आमला', 'अमला', 'हेयर ऑयल'],
    variants: [
      { id: 'AS-100', size: '100 ml', key: '100ml', price: 55, caseQty: 72, def: true },
      { id: 'AS-200', size: '200 ml', key: '200ml', price: 99, caseQty: 48 },
    ] },
  { key: 'SF', name: 'Sunfresh Sunflower Oil', short: 'Sunfresh',
    aliases: ['sunfresh', 'sun fresh', 'sunflower oil', 'sunflower', 'refined oil', 'refined', 'cooking oil', 'सनफ्रेश', 'सनफ्लावर', 'रिफाइंड'],
    variants: [
      { id: 'SF-1L', size: '1 L pouch', key: '1l', price: 155, caseQty: 12, def: true },
      { id: 'SF-5L', size: '5 L jar', key: '5l', price: 740, caseQty: 4 },
    ] },
  { key: 'GL', name: 'Golden Leaf Tea', short: 'Golden Leaf',
    aliases: ['golden leaf', 'goldenleaf', 'tea', 'chai', 'chai patti', 'chaipatti', 'चाय', 'चाय पत्ती', 'गोल्डन लीफ'],
    variants: [
      { id: 'GL-250', size: '250 g', key: '250g', price: 140, caseQty: 40, def: true },
      { id: 'GL-500', size: '500 g', key: '500g', price: 270, caseQty: 20 },
    ] },
  { key: 'MC', name: 'Morning Crunch Biscuits', short: 'Morning Crunch',
    aliases: ['morning crunch', 'crunch', 'biscuit', 'biscuits', 'biskut', 'बिस्कुट', 'क्रंच'],
    variants: [
      { id: 'MC-10', size: '₹10 pack', key: 'rs10', price: 10, caseQty: 96, def: true },
      { id: 'MC-30', size: '₹30 pack', key: 'rs30', price: 30, caseQty: 48 },
    ] },
  { key: 'PS', name: 'Pearl Bath Soap', short: 'Pearl Soap',
    aliases: ['pearl soap', 'pearl', 'soap', 'sabun', 'bath soap', 'साबुन', 'पर्ल'],
    variants: [
      { id: 'PS-100', size: '100 g', key: '100g', price: 38, caseQty: 144, def: true },
      { id: 'PS-150', size: '150 g', key: '150g', price: 52, caseQty: 96 },
    ] },
  { key: 'BW', name: 'Brite Wash Detergent', short: 'Brite Wash',
    aliases: ['brite wash', 'bright wash', 'britewash', 'brightwash', 'detergent', 'washing powder', 'surf', 'सर्फ', 'डिटर्जेंट', 'ब्राइट वॉश'],
    variants: [
      { id: 'BW-500', size: '500 g', key: '500g', price: 60, caseQty: 24, def: true },
      { id: 'BW-1K', size: '1 kg', key: '1kg', price: 115, caseQty: 12 },
    ] },
  { key: 'SM', name: 'Smile Toothpaste', short: 'Smile',
    aliases: ['smile toothpaste', 'smile', 'toothpaste', 'tooth paste', 'paste', 'टूथपेस्ट', 'पेस्ट', 'स्माइल'],
    variants: [
      { id: 'SM-100', size: '100 g', key: '100g', price: 55, caseQty: 72, def: true },
      { id: 'SM-200', size: '200 g', key: '200g', price: 105, caseQty: 36 },
    ] },
  { key: 'SK', name: 'Silky Shampoo', short: 'Silky',
    aliases: ['silky shampoo', 'silky', 'shampoo', 'शैम्पू', 'शैंपू', 'सिल्की'],
    variants: [
      { id: 'SK-STR', size: '₹2 sachet strip (16)', key: 'rs2', price: 32, caseQty: 24, def: true },
      { id: 'SK-180', size: '180 ml', key: '180ml', price: 160, caseQty: 24 },
    ] },
  { key: 'QN', name: 'Quick Noodles', short: 'Quick Noodles',
    aliases: ['quick noodles', 'noodles', 'noodle', 'quick', 'नूडल्स', 'क्विक'],
    variants: [
      { id: 'QN-70', size: '70 g single', key: '70g', price: 14, caseQty: 96, def: true },
      { id: 'QN-280', size: '280 g 4-pack', key: '280g', price: 56, caseQty: 24 },
    ] },
];

export const SKUS = FAMILIES.flatMap(f => f.variants.map(v => ({ ...v, family: f.key, name: f.name, short: f.short })));
export const skuById = Object.fromEntries(SKUS.map(s => [s.id, s]));

export const REP = { name: 'Ravi Kumar', beat: 'Andheri East · Beat 3', distributor: 'Shree Ganesh Distributors' };

export const OUTLETS = [
  { id: 'O1', name: 'Sharma General Store', area: 'Saki Naka', owner: 'Rakesh Sharma' },
  { id: 'O2', name: 'Balaji Kirana', area: 'Marol', owner: 'Venkatesh R.' },
  { id: 'O3', name: 'New Gupta Provision', area: 'Chakala', owner: 'Anil Gupta' },
  { id: 'O4', name: 'Laxmi Stores', area: 'JB Nagar', owner: 'Meena Patil' },
  { id: 'O5', name: 'Om Sai Traders', area: 'Andheri-Kurla Road', owner: 'Santosh Jadhav' },
  { id: 'O6', name: 'Krishna Super Mart', area: 'Marol Naka', owner: 'Dinesh Shah' },
];

export const NO_ORDER_REASONS = ['Shop closed', 'Enough stock', 'Payment pending', 'Owner not available', 'Competitor scheme'];

export const SAMPLES = {
  english: 'Coco Gold 200 ml two dozen, Golden Leaf tea 500 gram 10 packets, Brite Wash 1 kg one case, and the shopkeeper says Pearl soap is out of stock.',
  hindi: 'Coco Gold sau ml do darjan, chai paanch packet, Brite Wash ek peti aur Pearl sabun khatam ho gaya hai.',
};

// Previous visit per outlet (fictional) — powers "Repeat last order".
export const LAST_ORDERS = {
  O1: { daysAgo: 7, lines: [{ sku: 'CG-200', qty: 2, unit: 'dozen' }, { sku: 'GL-250', qty: 10, unit: 'pcs' }, { sku: 'BW-500', qty: 1, unit: 'case' }] },
  O2: { daysAgo: 7, lines: [{ sku: 'CG-100', qty: 3, unit: 'dozen' }, { sku: 'MC-10', qty: 1, unit: 'case' }] },
  O3: { daysAgo: 14, lines: [{ sku: 'PS-100', qty: 2, unit: 'dozen' }, { sku: 'SM-100', qty: 1, unit: 'dozen' }] },
  O4: { daysAgo: 7, lines: [{ sku: 'SF-1L', qty: 1, unit: 'case' }, { sku: 'SK-STR', qty: 10, unit: 'pcs' }] },
  O5: { daysAgo: 7, lines: [{ sku: 'QN-70', qty: 2, unit: 'case' }, { sku: 'MC-30', qty: 2, unit: 'dozen' }, { sku: 'GL-500', qty: 6, unit: 'pcs' }] },
  O6: { daysAgo: 7, lines: [{ sku: 'AS-200', qty: 12, unit: 'pcs' }, { sku: 'PS-150', qty: 1, unit: 'dozen' }] },
};
