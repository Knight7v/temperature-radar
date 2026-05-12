// 测试模式检测和管理模块
const TestMode = (function() {
    let isTestMode = false;

    // 初始化
    function init() {
        checkTestMode();

        // 每秒检查一次测试模式状态
        setInterval(checkTestMode, 1000);
    }

    // 检查是否处于测试模式
    function checkTestMode() {
        const testPayment = localStorage.getItem('test_payment');
        const wasTestMode = isTestMode;
        isTestMode = !!testPayment;

        // 状态变化时更新UI
        if (wasTestMode !== isTestMode) {
            updateTestModeUI();
        }
    }

    // 更新测试模式UI
    function updateTestModeUI() {
        const indicator = document.getElementById('testModeIndicator');
        const body = document.body;

        if (isTestMode) {
            // 显示测试模式指示器
            if (indicator) {
                indicator.style.display = 'inline-flex';
            }

            // 添加测试模式横幅
            if (!document.querySelector('.test-mode-banner-top')) {
                showTestModeBanner();
            }

            // 给body添加标记
            body.classList.add('test-mode-active');

            // 在控制台输出提示
            console.log('%c🧪 测试模式已启用', 'color: #f093fb; font-size: 14px; font-weight: bold;');
            console.log('%c当前使用的是模拟支付数据，不会产生真实交易', 'color: #999; font-size: 12px;');

        } else {
            // 隐藏测试模式指示器
            if (indicator) {
                indicator.style.display = 'none';
            }

            // 移除测试模式横幅
            const banner = document.querySelector('.test-mode-banner-top');
            if (banner) {
                banner.remove();
            }

            // 移除body标记
            body.classList.remove('test-mode-active', 'has-test-banner');
        }
    }

    // 显示测试模式横幅
    function showTestModeBanner() {
        const testPayment = JSON.parse(localStorage.getItem('test_payment'));
        const productName = testPayment ? testPayment.productName : '未知产品';

        const banner = document.createElement('div');
        banner.className = 'test-mode-banner test-mode-banner-top';
        banner.innerHTML = `
            <div class="test-mode-banner-content">
                <div class="test-mode-banner-title">🧪 测试模式已启用</div>
                <div class="test-mode-banner-desc">
                    您已购买：${productName}（模拟支付，不会产生真实交易）
                </div>
            </div>
            <div class="test-mode-banner-actions">
                <a href="payment-demo.html">测试页面</a>
                <a href="#" onclick="TestMode.clear(); return false;">清除测试</a>
            </div>
        `;

        document.body.insertBefore(banner, document.body.firstChild);
        document.body.classList.add('has-test-banner');
    }

    // 清除测试模式
    function clear() {
        localStorage.removeItem('test_payment');
        updateTestModeUI();
        console.log('%c✅ 测试模式已清除', 'color: #52c41a; font-size: 14px; font-weight: bold;');
    }

    // 获取测试支付数据
    function getTestData() {
        if (!isTestMode) return null;

        try {
            return JSON.parse(localStorage.getItem('test_payment'));
        } catch (error) {
            return null;
        }
    }

    // 检查是否有某个功能的权限
    function hasFeaturePermission(feature) {
        const testData = getTestData();
        if (!testData || !testData.features) return false;
        return testData.features.includes(feature);
    }

    // 获取测试用户信息
    function getTestUser() {
        const testData = getTestData();
        if (!testData) return null;

        return {
            user_id: 'test_user',
            phone: '13800138000',
            nickname: '测试用户',
            avatar: null,
            is_test_mode: true
        };
    }

    // 公开API
    return {
        init,
        clear,
        isActive: () => isTestMode,
        getTestData,
        hasFeaturePermission,
        getTestUser
    };
})();

// 页面加载时初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        TestMode.init();
    });
}
