// Simple Node.js test for future7Days implementation
// Run with: node test-future7days.js

// Mock the DOM environment
global.document = {
    createElement: () => ({})
};

// Load the Core module
const fs = require('fs');
const coreCode = fs.readFileSync('./js/core.js', 'utf8');

// Evaluate the Core module
eval(coreCode);

console.log('=== Testing future7Days Implementation ===\n');

// Test 1: Generate city data
console.log('Test 1: Generate city data');
const cityData = Core.generateAllCityData()[0];
console.log(`  City: ${cityData.cityName}`);
console.log(`  Has future7Days: ${cityData.hasOwnProperty('future7Days')}`);

if (!cityData.hasOwnProperty('future7Days')) {
    console.error('  ✗ FAIL: future7Days field missing!');
    process.exit(1);
}

// Test 2: Check array length
console.log('\nTest 2: Array length');
console.log(`  future7Days.length: ${cityData.future7Days.length}`);
if (cityData.future7Days.length !== 7) {
    console.error('  ✗ FAIL: Array should have 7 elements!');
    process.exit(1);
}
console.log('  ✓ Array has 7 elements');

// Test 3: Check first day structure
console.log('\nTest 3: First day structure');
const day0 = cityData.future7Days[0];
console.log(`  Has date: ${day0.hasOwnProperty('date')}`);
console.log(`  date is Date: ${day0.date instanceof Date}`);
if (!(day0.date instanceof Date)) {
    console.error('  ✗ FAIL: date should be a Date object!');
    process.exit(1);
}
console.log('  ✓ date is a Date object');

console.log(`  Has dayMax: ${day0.hasOwnProperty('dayMax')}`);
console.log(`  dayMax type: ${typeof day0.dayMax}`);
console.log(`  dayMax value: ${day0.dayMax}`);

console.log(`  Has nightMin: ${day0.hasOwnProperty('nightMin')}`);
console.log(`  nightMin type: ${typeof day0.nightMin}`);
console.log(`  nightMin value: ${day0.nightMin}`);

console.log(`  Has adiScore: ${day0.hasOwnProperty('adiScore')}`);
console.log(`  adiScore type: ${typeof day0.adiScore}`);
console.log(`  adiScore value: ${day0.adiScore}`);
if (typeof day0.adiScore !== 'number') {
    console.error('  ✗ FAIL: adiScore should be a number!');
    process.exit(1);
}
console.log('  ✓ adiScore is a number');

console.log(`  Has level: ${day0.hasOwnProperty('level')}`);
console.log(`  level value: ${day0.level}`);

console.log(`  Has isHotNight: ${day0.hasOwnProperty('isHotNight')}`);
console.log(`  isHotNight value: ${day0.isHotNight}`);

// Test 4: Check all days have required fields
console.log('\nTest 4: All days structure');
const requiredFields = ['date', 'dayMax', 'nightMin', 'dayFeelsLike', 'nightFeelsLike', 'humidity', 'adiScore', 'level', 'isHotNight'];
let allDaysValid = true;

for (let i = 0; i < 7; i++) {
    const day = cityData.future7Days[i];
    const missingFields = requiredFields.filter(f => !day.hasOwnProperty(f));
    if (missingFields.length > 0) {
        console.error(`  ✗ Day ${i} missing fields: ${missingFields.join(', ')}`);
        allDaysValid = false;
    }
}

if (!allDaysValid) {
    console.error('  ✗ FAIL: Some days are missing required fields!');
    process.exit(1);
}
console.log('  ✓ All 7 days have required fields');

// Test 5: Date progression
console.log('\nTest 5: Date progression');
const today = new Date();
for (let i = 0; i < 7; i++) {
    const expectedDate = new Date(today);
    expectedDate.setDate(today.getDate() + i);
    const actualDate = cityData.future7Days[i].date;
    const datesMatch = expectedDate.getDate() === actualDate.getDate() &&
                     expectedDate.getMonth() === actualDate.getMonth();
    console.log(`  Day ${i}: ${actualDate.toDateString()} ${datesMatch ? '✓' : '✗'}`);
}

// Test 6: Temperature ranges are reasonable
console.log('\nTest 6: Temperature ranges');
const allTemps = cityData.future7Days.flatMap(d => [d.dayMax, d.nightMin]);
const maxTemp = Math.max(...allTemps);
const minTemp = Math.min(...allTemps);
console.log(`  Max temp: ${maxTemp}°C`);
console.log(`  Min temp: ${minTemp}°C`);

if (maxTemp < 10 || maxTemp > 50 || minTemp < 0 || minTemp > 40) {
    console.error('  ✗ FAIL: Temperature ranges seem unreasonable!');
    process.exit(1);
}
console.log('  ✓ Temperatures in reasonable range');

// Test 7: ADI scores in valid range
console.log('\nTest 7: ADI scores');
const adiScores = cityData.future7Days.map(d => d.adiScore);
const maxAdi = Math.max(...adiScores);
const minAdi = Math.min(...adiScores);
console.log(`  Max ADI: ${maxAdi}`);
console.log(`  Min ADI: ${minAdi}`);
const allValid = adiScores.every(s => s >= 0 && s <= 100);
if (!allValid) {
    console.error('  ✗ FAIL: Some ADI scores are out of range!');
    process.exit(1);
}
console.log('  ✓ All ADI scores in [0, 100]');

console.log('\n=== All Tests Complete ===');
console.log('✓ No assertion errors found');
console.log('✓ future7Days array properly implemented');
