// 用户认证模块
const Auth = (function() {
    let currentUser = null;
    let token = localStorage.getItem('auth_token');

    // API基础URL
    const API_BASE = '/api/auth';

    // 初始化
    function init() {
        // 检查本地存储的token
        if (token) {
            verifyToken();
        }

        // 绑定登录tab切换事件
        document.querySelectorAll('.login-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                switchLoginTab(e.target.dataset.type);
            });
        });

        // 绑定手机号输入事件
        const phoneInput = document.getElementById('loginPhone');
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
            });
        }

        // 绑定验证码输入事件
        const codeInput = document.getElementById('loginCode');
        if (codeInput) {
            codeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
            });
        }
    }

    // 验证Token
    async function verifyToken() {
        try {
            const response = await fetch(`${API_BASE}/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                currentUser = data.data.user;
                updateUI();
                return true;
            } else {
                logout();
                return false;
            }
        } catch (error) {
            console.error('Token验证失败:', error);
            logout();
            return false;
        }
    }

    // 发送验证码
    async function sendCode() {
        const phone = document.getElementById('loginPhone').value;

        if (!phone || phone.length !== 11) {
            showToast('请输入正确的手机号', 'error');
            return;
        }

        const btn = document.getElementById('sendCodeBtn');
        btn.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/send-code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phone })
            });

            const data = await response.json();

            if (data.success) {
                showToast('验证码已发送', 'success');

                // 开发环境显示验证码
                if (data.code) {
                    console.log('验证码:', data.code);
                    showToast(`开发环境验证码: ${data.code}`, 'info');
                }

                // 倒计时
                let countdown = 60;
                const timer = setInterval(() => {
                    btn.textContent = `${countdown}秒后重试`;
                    countdown--;

                    if (countdown < 0) {
                        clearInterval(timer);
                        btn.disabled = false;
                        btn.textContent = '发送验证码';
                    }
                }, 1000);
            } else {
                showToast(data.error || '发送失败', 'error');
                btn.disabled = false;
            }
        } catch (error) {
            console.error('发送验证码失败:', error);
            showToast('发送失败，请重试', 'error');
            btn.disabled = false;
        }
    }

    // 手机号登录
    async function phoneLogin() {
        const phone = document.getElementById('loginPhone').value;
        const code = document.getElementById('loginCode').value;

        if (!phone || phone.length !== 11) {
            showToast('请输入正确的手机号', 'error');
            return;
        }

        if (!code || code.length !== 6) {
            showToast('请输入验证码', 'error');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phone, code })
            });

            const data = await response.json();

            if (data.success) {
                currentUser = data.data.user;
                token = data.data.token;

                localStorage.setItem('auth_token', token);
                updateUI();
                closeModal();
                showToast('登录成功', 'success');
            } else {
                showToast(data.error || '登录失败', 'error');
            }
        } catch (error) {
            console.error('登录失败:', error);
            showToast('登录失败，请重试', 'error');
        }
    }

    // 微信登录（占位符）
    function wechatLogin() {
        showToast('微信登录功能开发中', 'info');
    }

    // 登出
    async function logout() {
        if (!token) return;

        try {
            await fetch(`${API_BASE}/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (error) {
            console.error('登出请求失败:', error);
        }

        currentUser = null;
        token = null;
        localStorage.removeItem('auth_token');
        updateUI();
        showToast('已登出', 'success');
    }

    // 打开登录模态框
    function openModal() {
        document.getElementById('loginModal').classList.add('active');
    }

    // 关闭登录模态框
    function closeModal() {
        document.getElementById('loginModal').classList.remove('active');
    }

    // 切换登录tab
    function switchLoginTab(type) {
        // 更新tab样式
        document.querySelectorAll('.login-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });

        // 切换表单
        document.querySelectorAll('.login-form').forEach(form => {
            form.classList.remove('active');
        });

        if (type === 'phone') {
            document.getElementById('phoneLoginForm').classList.add('active');
        } else if (type === 'wechat') {
            document.getElementById('wechatLoginForm').classList.add('active');
            // TODO: 生成微信二维码
        }
    }

    // 更新UI
    function updateUI() {
        const userInfoBar = document.querySelector('.user-info-bar');
        const loginBtn = document.querySelector('.login-btn');

        if (currentUser) {
            // 显示用户信息
            if (userInfoBar) {
                userInfoBar.style.display = 'flex';
                document.querySelector('.user-name').textContent = currentUser.nickname || currentUser.phone?.slice(-4);
            }

            // 隐藏登录按钮
            if (loginBtn) {
                loginBtn.style.display = 'none';
            }

            // 检查订阅状态
            checkSubscription();
        } else {
            // 隐藏用户信息
            if (userInfoBar) {
                userInfoBar.style.display = 'none';
            }

            // 显示登录按钮
            if (loginBtn) {
                loginBtn.style.display = 'block';
            }
        }
    }

    // 检查订阅状态
    async function checkSubscription() {
        if (!currentUser) return;

        try {
            const response = await fetch('/api/subscription/status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success && data.data.subscription) {
                const subBadge = document.querySelector('.user-subscription');
                if (subBadge) {
                    subBadge.textContent = data.data.subscription.plan_name || '已订阅';
                    subBadge.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('检查订阅状态失败:', error);
        }
    }

    // 检查权限
    async function checkPermission(feature) {
        // 测试模式：检查本地存储的测试支付
        const testPayment = localStorage.getItem('test_payment');
        if (testPayment) {
            const paymentData = JSON.parse(testPayment);
            if (paymentData.features && paymentData.features.includes(feature)) {
                console.log('测试模式：使用测试支付权限');
                return true;
            }
        }

        if (!currentUser) {
            openModal();
            return false;
        }

        try {
            const response = await fetch(`/api/permissions/check?feature=${feature}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success && data.data.has_access) {
                return true;
            } else {
                Payment.openModal(feature);
                return false;
            }
        } catch (error) {
            console.error('检查权限失败:', error);
            return false;
        }
    }

    // 获取当前用户
    function getCurrentUser() {
        return currentUser;
    }

    // 获取Token
    function getToken() {
        return token;
    }

    // 显示Toast
    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = message;
            toast.className = `toast toast-${type}`;
            toast.style.display = 'block';

            setTimeout(() => {
                toast.style.display = 'none';
            }, 3000);
        }
    }

    // 公开API
    return {
        init,
        sendCode,
        phoneLogin,
        wechatLogin,
        logout,
        openModal,
        closeModal,
        checkPermission,
        getCurrentUser,
        getToken
    };
})();

// 页面加载时初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        Auth.init();
    });
}
