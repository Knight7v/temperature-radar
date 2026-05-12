// 广告模块
const Ads = (function() {
    let ads = [];

    // 初始化
    async function init() {
        try {
            const response = await fetch('/api/ads');
            const data = await response.json();

            if (data.success) {
                ads = data.data || [];
                renderAds();
            }
        } catch (error) {
            console.error('加载广告失败:', error);
        }
    }

    // 渲染广告
    function renderAds() {
        // 顶部Banner广告
        const topBannerAd = ads.find(ad =>
            ad.position === 'top_banner' &&
            ad.status === 'active' &&
            new Date(ad.start_date) <= new Date() &&
            new Date(ad.end_date) >= new Date()
        );

        if (topBannerAd) {
            renderTopBanner(topBannerAd);
        }

        // 右侧卡片广告
        const rightCardAd = ads.find(ad =>
            ad.position === 'right_card' &&
            ad.status === 'active' &&
            new Date(ad.start_date) <= new Date() &&
            new Date(ad.end_date) >= new Date()
        );

        if (rightCardAd) {
            renderRightCard(rightCardAd);
        }
    }

    // 渲染顶部Banner广告
    function renderTopBanner(ad) {
        const container = document.querySelector('.header') || document.querySelector('.app-container');
        if (!container) return;

        const banner = document.createElement('div');
        banner.className = 'ad-banner';
        banner.dataset.adId = ad.ad_id;
        banner.innerHTML = `
            <button class="ad-banner-close" onclick="Ads.closeAd('${ad.ad_id}')">×</button>
            <div class="ad-banner-content">
                <div class="ad-banner-title">${ad.title}</div>
                <div class="ad-banner-desc">${ad.description || ''}</div>
            </div>
            <a href="${ad.link_url}" target="_blank" class="ad-banner-cta" onclick="Ads.trackClick('${ad.ad_id}')">
                了解详情
            </a>
        `;

        container.insertBefore(banner, container.firstChild);

        // 跟踪曝光
        trackView(ad.ad_id);
    }

    // 渲染右侧卡片广告
    function renderRightCard(ad) {
        const sidebar = document.querySelector('.right-sidebar');
        if (!sidebar) return;

        const card = document.createElement('div');
        card.className = 'ad-card';
        card.dataset.adId = ad.ad_id;
        card.innerHTML = `
            <button class="ad-card-close" onclick="Ads.closeAd('${ad.ad_id}')">×</button>
            ${ad.image_url ? `<img src="${ad.image_url}" alt="${ad.title}">` : ''}
            <div class="ad-card-title">${ad.title}</div>
            ${ad.description ? `<div class="ad-card-desc">${ad.description}</div>` : ''}
            <a href="${ad.link_url}" target="_blank" class="ad-card-link" onclick="Ads.trackClick('${ad.ad_id}')">
                ${ad.cta_text || '了解更多'}
            </a>
        `;

        sidebar.insertBefore(card, sidebar.firstChild);

        // 跟踪曝光
        trackView(ad.ad_id);
    }

    // 关闭广告
    function closeAd(adId) {
        const adElement = document.querySelector(`[data-ad-id="${adId}"]`);
        if (adElement) {
            adElement.remove();
        }

        // 保存关闭状态到本地存储（24小时不再显示）
        localStorage.setItem(`ad_closed_${adId}`, Date.now());
    }

    // 检查广告是否应该显示
    function shouldShowAd(adId) {
        const closedTime = localStorage.getItem(`ad_closed_${adId}`);
        if (!closedTime) return true;

        const oneDay = 24 * 60 * 60 * 1000;
        return Date.now() - closedTime > oneDay;
    }

    // 跟踪曝光
    async function trackView(adId) {
        if (!shouldShowAd(adId)) return;

        try {
            await fetch(`/api/ads/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ad_id: adId,
                    action: 'view'
                })
            });
        } catch (error) {
            console.error('跟踪曝光失败:', error);
        }
    }

    // 跟踪点击
    async function trackClick(adId) {
        try {
            await fetch(`/api/ads/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ad_id: adId,
                    action: 'click'
                })
            });
        } catch (error) {
            console.error('跟踪点击失败:', error);
        }
    }

    // 公开API
    return {
        init,
        closeAd,
        trackClick
    };
})();

// 页面加载时初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        Ads.init();
    });
}
