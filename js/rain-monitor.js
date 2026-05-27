/**
 * RainMonitor Module - 降雨投保提醒与雨后湿热机会
 */

(function(root, factory) {
    const moduleValue = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = moduleValue;
    }
    root.RainMonitor = moduleValue;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    const INSURANCE_LEVEL_ORDER = { none: 0, remind: 1, strong: 2 };
    const MUGGY_LEVEL_ORDER = { none: 0, watch: 1, medium: 2, high: 3 };

    const STRONG_RAIN_KEYWORDS = ['中到大雨', '小到中雨', '强雷阵雨', '强阵雨', '特大暴雨', '大暴雨', '暴雨', '大雨', '中雨'];
    const REMIND_RAIN_KEYWORDS = ['零星小雨', '毛毛雨', '雷阵雨', '阵雨', '小雨'];

    const INSURANCE_LABELS = {
        none: '无提醒',
        remind: '提醒投保',
        strong: '强提醒'
    };

    const MUGGY_LABELS = {
        none: '无明显机会',
        watch: '观察',
        medium: '中机会',
        high: '高机会'
    };

    function toNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function combineWeatherText(day) {
        return [day.weatherTextDay, day.weatherTextNight, day.weatherText, day.textDay, day.textNight]
            .filter(Boolean)
            .join(' / ');
    }

    function hasKeyword(text, keywords) {
        return keywords.find(keyword => text.includes(keyword)) || '';
    }

    function formatDate(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function calculateInsuranceReminder(day) {
        const text = combineWeatherText(day);
        const precip = toNumber(day.precip, 0);
        const strongKeyword = hasKeyword(text, STRONG_RAIN_KEYWORDS);
        if (strongKeyword) {
            return {
                level: 'strong',
                label: INSURANCE_LABELS.strong,
                reason: `${strongKeyword}，配送照常，强提醒购买送货保险`
            };
        }
        if (precip >= 10) {
            return {
                level: 'strong',
                label: INSURANCE_LABELS.strong,
                reason: `预计降水${precip}mm，配送照常，强提醒购买送货保险`
            };
        }
        const remindKeyword = hasKeyword(text, REMIND_RAIN_KEYWORDS);
        if (remindKeyword) {
            return {
                level: 'remind',
                label: INSURANCE_LABELS.remind,
                reason: `${remindKeyword}，配送照常，提醒购买送货保险`
            };
        }
        if (precip > 0) {
            return {
                level: 'remind',
                label: INSURANCE_LABELS.remind,
                reason: `预计降水${precip}mm，配送照常，提醒购买送货保险`
            };
        }
        return {
            level: 'none',
            label: INSURANCE_LABELS.none,
            reason: '未来该日无明显降水'
        };
    }

    function hadRain(day) {
        return calculateInsuranceReminder(day).level !== 'none';
    }

    function calculatePostRainMuggy(days, dayIndex) {
        const current = days[dayIndex];
        const previousCandidates = [dayIndex - 1, dayIndex - 2]
            .filter(index => index >= 0)
            .map(index => ({ index, day: days[index] }))
            .filter(item => hadRain(item.day));

        if (previousCandidates.length === 0) {
            return {
                score: 0,
                level: 'none',
                label: MUGGY_LABELS.none,
                reason: '前1-2天无降水，未形成雨后湿热信号'
            };
        }

        const rainDay = previousCandidates[0].day;
        const dayMax = toNumber(current.dayMax, toNumber(current.maxTemp, 0));
        const rainDayMax = toNumber(rainDay.dayMax, toNumber(rainDay.maxTemp, dayMax));
        const tempRise = dayMax - rainDayMax;
        const humidity = toNumber(current.humidity, 0);
        const dayFeelsLike = toNumber(current.dayFeelsLike, toNumber(current.feelsLike, dayMax));
        const rainFeelsLike = toNumber(rainDay.dayFeelsLike, toNumber(rainDay.feelsLike, dayFeelsLike));
        const feelsRise = dayFeelsLike - rainFeelsLike;
        const adiScore = toNumber(current.adiScore, 0);
        const rainAdiScore = toNumber(rainDay.adiScore, adiScore);
        const adiRise = adiScore - rainAdiScore;
        const nightMin = toNumber(current.nightMin, toNumber(current.nightMinTemp, 0));
        const nightFeelsLike = toNumber(current.nightFeelsLike, nightMin);

        let score = 20;
        const reasons = ['前1-2天有降水'];

        if (tempRise >= 5) {
            score += 30;
            reasons.push(`雨后升温${tempRise}℃`);
        } else if (tempRise >= 3) {
            score += 20;
            reasons.push(`雨后升温${tempRise}℃`);
        }

        if (humidity >= 80) {
            score += 25;
            reasons.push(`湿度${humidity}%`);
        } else if (humidity >= 70) {
            score += 15;
            reasons.push(`湿度${humidity}%`);
        }

        if (dayFeelsLike >= 34) {
            score += 15;
            reasons.push(`体感${dayFeelsLike}℃`);
        }
        if (feelsRise >= 3) {
            score += 15;
            reasons.push(`体感上升${feelsRise}℃`);
        }
        if (adiRise >= 8) {
            score += 15;
            reasons.push(`ADI上升${adiRise}分`);
        }
        if (nightMin >= 26 || nightFeelsLike >= 30) {
            score += 10;
            reasons.push(`夜间${nightMin}℃/体感${nightFeelsLike}℃`);
        }

        const cappedScore = Math.min(score, 100);
        let level = 'none';
        if (cappedScore >= 70) level = 'high';
        else if (cappedScore >= 45) level = 'medium';
        else if (cappedScore >= 25) level = 'watch';

        return {
            score: cappedScore,
            level,
            label: MUGGY_LABELS[level],
            reason: level === 'none' ? '雨后湿热信号不足' : reasons.join('，'),
            rainDate: formatDate(rainDay.date),
            tempRise,
            adiRise
        };
    }

    function enrichFuture7Days(days) {
        const normalized = (days || []).map(day => {
            const insurance = calculateInsuranceReminder(day);
            return {
                ...day,
                weatherTextDay: day.weatherTextDay || day.textDay || '',
                weatherTextNight: day.weatherTextNight || day.textNight || '',
                weatherText: day.weatherText || combineWeatherText(day) || '无明显降水',
                precip: toNumber(day.precip, 0),
                rainInsuranceLevel: insurance.level,
                rainInsuranceLabel: insurance.label,
                rainInsuranceReason: insurance.reason
            };
        });

        return normalized.map((day, index) => {
            const muggy = calculatePostRainMuggy(normalized, index);
            return {
                ...day,
                postRainMuggyScore: muggy.score,
                postRainMuggyLevel: muggy.level,
                postRainMuggyLabel: muggy.label,
                postRainMuggyReason: muggy.reason,
                postRainMuggyRainDate: muggy.rainDate || '',
                postRainMuggyTempRise: muggy.tempRise || 0,
                postRainMuggyAdiRise: muggy.adiRise || 0
            };
        });
    }

    function flattenCityDays(cityDataList) {
        return (cityDataList || []).flatMap(city => (city.future7Days || []).map((day, index) => ({
            cityName: city.cityName,
            province: city.province,
            region: city.region,
            adiScore: city.adiScore,
            day,
            dayIndex: index
        })));
    }

    function summarizeRainInsurance(cityDataList) {
        const records = getTopInsuranceCities(cityDataList, 999);
        return {
            strongCount: records.filter(record => record.day.rainInsuranceLevel === 'strong').length,
            remindCount: records.filter(record => record.day.rainInsuranceLevel === 'remind').length,
            topRecords: records.slice(0, 3)
        };
    }

    function summarizePostRainMuggy(cityDataList) {
        const records = getTopPostRainMuggyCities(cityDataList, 999);
        return {
            highCount: records.filter(record => record.day.postRainMuggyLevel === 'high').length,
            mediumCount: records.filter(record => record.day.postRainMuggyLevel === 'medium').length,
            watchCount: records.filter(record => record.day.postRainMuggyLevel === 'watch').length,
            topRecords: records.slice(0, 3)
        };
    }

    function getTopInsuranceCities(cityDataList, limit) {
        return flattenCityDays(cityDataList)
            .filter(record => record.day.rainInsuranceLevel && record.day.rainInsuranceLevel !== 'none')
            .sort((a, b) => {
                const levelDiff = INSURANCE_LEVEL_ORDER[b.day.rainInsuranceLevel] - INSURANCE_LEVEL_ORDER[a.day.rainInsuranceLevel];
                if (levelDiff !== 0) return levelDiff;
                if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
                return toNumber(b.day.precip, 0) - toNumber(a.day.precip, 0);
            })
            .slice(0, limit || 10);
    }

    function getTopPostRainMuggyCities(cityDataList, limit) {
        return flattenCityDays(cityDataList)
            .filter(record => record.day.postRainMuggyLevel && record.day.postRainMuggyLevel !== 'none')
            .sort((a, b) => {
                const scoreDiff = toNumber(b.day.postRainMuggyScore, 0) - toNumber(a.day.postRainMuggyScore, 0);
                if (scoreDiff !== 0) return scoreDiff;
                if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
                return toNumber(b.day.postRainMuggyAdiRise, 0) - toNumber(a.day.postRainMuggyAdiRise, 0);
            })
            .slice(0, limit || 10);
    }

    function getMaxRainInsuranceLevel(days) {
        return (days || []).reduce((max, day) => (
            INSURANCE_LEVEL_ORDER[day.rainInsuranceLevel] > INSURANCE_LEVEL_ORDER[max] ? day.rainInsuranceLevel : max
        ), 'none');
    }

    function getMaxPostRainMuggyLevel(days) {
        return (days || []).reduce((max, day) => (
            MUGGY_LEVEL_ORDER[day.postRainMuggyLevel] > MUGGY_LEVEL_ORDER[max] ? day.postRainMuggyLevel : max
        ), 'none');
    }

    return {
        INSURANCE_LABELS,
        MUGGY_LABELS,
        calculateInsuranceReminder,
        calculatePostRainMuggy,
        enrichFuture7Days,
        summarizeRainInsurance,
        summarizePostRainMuggy,
        getTopInsuranceCities,
        getTopPostRainMuggyCities,
        getMaxRainInsuranceLevel,
        getMaxPostRainMuggyLevel
    };
});
