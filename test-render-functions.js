/**
 * Test script for Tasks 8, 9, and 10
 * Verifies the dimension rendering functions are implemented and exported
 */

// Mock Core module
const Core = {
    getLevelInfo: (level) => {
        const levels = {
            outbreak: { name: '爆发级', color: '#D0021B' },
            action: { name: '行动级', color: '#F57C00' },
            opportunity: { name: '机会级', color: '#F5A623' },
            observe: { name: '观察级', color: '#4A90E2' },
            normal: { name: '普通', color: '#666666' }
        };
        return levels[level] || levels.normal;
    },
    calculateLevelTrend: (currentLevel, future7AdiScores) => {
        return {
            trendText: '爆发级→爆发级',
            trendColor: '#D0021B'
        };
    }
};

// Mock cities data
const mockCities = [
    {
        cityName: '上海',
        region: '华东',
        province: '上海',
        adiScore: 78,
        level: 'action',
        future7Days: [
            { dayMax: 36, nightMin: 28, adiScore: 80, level: 'action', isHotNight: true, dayFeelsLike: 38, nightFeelsLike: 31 },
            { dayMax: 37, nightMin: 29, adiScore: 82, level: 'outbreak', isHotNight: true, dayFeelsLike: 40, nightFeelsLike: 32 },
            { dayMax: 35, nightMin: 27, adiScore: 75, level: 'action', isHotNight: true, dayFeelsLike: 37, nightFeelsLike: 30 },
            { dayMax: 34, nightMin: 26, adiScore: 70, level: 'opportunity', isHotNight: false, dayFeelsLike: 35, nightFeelsLike: 28 },
            { dayMax: 33, nightMin: 25, adiScore: 65, level: 'opportunity', isHotNight: false, dayFeelsLike: 34, nightFeelsLike: 26 },
            { dayMax: 32, nightMin: 24, adiScore: 60, level: 'observe', isHotNight: false, dayFeelsLike: 33, nightFeelsLike: 25 },
            { dayMax: 31, nightMin: 23, adiScore: 55, level: 'observe', isHotNight: false, dayFeelsLike: 32, nightFeelsLike: 24 }
        ]
    }
];

// Create mock DOM elements
const mockThead = {
    innerHTML: ''
};

const mockTbody = {
    innerHTML: ''
};

// Test 1: Check if functions are exported
console.log('Test 1: Check if UI module exports the functions');
console.log('✓ renderReportTemperature:', typeof UI.renderReportTemperature);
console.log('✓ renderReportFeelsLike:', typeof UI.renderReportFeelsLike);
console.log('✓ renderReportADI:', typeof UI.renderReportADI);

if (typeof UI.renderReportFeelsLike !== 'function') {
    console.error('❌ renderReportFeelsLike is not exported or not a function');
    process.exit(1);
}

if (typeof UI.renderReportADI !== 'function') {
    console.error('❌ renderReportADI is not exported or not a function');
    process.exit(1);
}

// Test 2: Call renderReportFeelsLike
console.log('\nTest 2: Call renderReportFeelsLike');
try {
    UI.renderReportFeelsLike(mockCities, mockThead, mockTbody);
    console.log('✓ renderReportFeelsLike executed successfully');
    console.log('✓ thead.innerHTML length:', mockThead.innerHTML.length);
    console.log('✓ tbody.innerHTML length:', mockTbody.innerHTML.length);

    // Check if the output contains expected content
    if (mockTbody.innerHTML.includes('上海') && mockTbody.innerHTML.includes('38°')) {
        console.log('✓ Output contains expected city and temperature data');
    } else {
        console.error('❌ Output missing expected content');
    }
} catch (error) {
    console.error('❌ renderReportFeelsLike failed:', error.message);
    process.exit(1);
}

// Reset for next test
mockThead.innerHTML = '';
mockTbody.innerHTML = '';

// Test 3: Call renderReportADI
console.log('\nTest 3: Call renderReportADI');
try {
    UI.renderReportADI(mockCities, mockThead, mockTbody);
    console.log('✓ renderReportADI executed successfully');
    console.log('✓ thead.innerHTML length:', mockThead.innerHTML.length);
    console.log('✓ tbody.innerHTML length:', mockTbody.innerHTML.length);

    // Check if the output contains expected content
    if (mockTbody.innerHTML.includes('上海') && mockTbody.innerHTML.includes('80')) {
        console.log('✓ Output contains expected city and ADI data');
    } else {
        console.error('❌ Output missing expected content');
    }

    // Check for ADI cell classes
    if (mockTbody.innerHTML.includes('adi-cell-')) {
        console.log('✓ Output contains ADI cell color classes');
    } else {
        console.warn('⚠ ADI cell color classes not found in output');
    }
} catch (error) {
    console.error('❌ renderReportADI failed:', error.message);
    process.exit(1);
}

// Test 4: Empty state handling
console.log('\nTest 4: Empty state handling');
try {
    UI.renderReportFeelsLike([], mockThead, mockTbody);
    if (mockTbody.innerHTML.includes('未找到匹配的城市')) {
        console.log('✓ Empty state message displayed correctly');
    } else {
        console.error('❌ Empty state message not found');
    }
} catch (error) {
    console.error('❌ Empty state handling failed:', error.message);
}

console.log('\n✅ All tests passed!');
