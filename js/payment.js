// 支付模块
const Payment = (function() {
    // API基础URL
    const API_BASE = '/api/payment';

    // 打开支付模态框
    function openModal(feature) {
        document.getElementById('paymentModal').classList.add('active');
    }

    // 关闭支付模态框
    function closeModal() {
        document.getElementById('paymentModal').classList.remove('active');
    }

    // 购买功能
    async function buy(feature, type) {
        const token = Auth.getToken();

        if (!token) {
            Auth.openModal();
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    product_id: feature,
                    order_type: type
                })
            });

            const data = await response.json();

            if (data.success) {
                // 显示支付二维码或跳转支付页面
                if (data.data.payment_url) {
                    window.open(data.data.payment_url, '_blank');
                } else if (data.data.qr_code) {
                    showPaymentQR(data.data);
                }

                // 轮询支付状态
                pollPaymentStatus(data.data.order_id);
            } else {
                showToast(data.error || '创建订单失败', 'error');
            }
        } catch (error) {
            console.error('购买失败:', error);
            showToast('购买失败，请重试', 'error');
        }
    }

    // 显示支付二维码
    function showPaymentQR(paymentData) {
        // 创建支付二维码模态框
        const qrModal = document.createElement('div');
        qrModal.className = 'payment-qr-modal active';
        qrModal.innerHTML = `
            <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="modal-content payment-qr-content">
                <div class="modal-header">
                    <h3>扫码支付</h3>
                    <button class="modal-close" onclick="this.closest('.payment-qr-modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="payment-amount">¥${paymentData.amount.toFixed(2)}</div>
                    <div class="payment-qr-code">
                        <img src="${paymentData.qr_code}" alt="支付二维码">
                    </div>
                    <p class="payment-tip">请使用手机扫描二维码完成支付</p>
                </div>
            </div>
        `;
        document.body.appendChild(qrModal);
    }

    // 轮询支付状态
    function pollPaymentStatus(orderId) {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_BASE}/status?order_id=${orderId}`);
                const data = await response.json();

                if (data.success && data.data.status === 'paid') {
                    clearInterval(interval);
                    closeModal();

                    // 移除支付二维码模态框
                    const qrModal = document.querySelector('.payment-qr-modal');
                    if (qrModal) {
                        qrModal.remove();
                    }

                    showToast('支付成功！', 'success');

                    // 刷新用户权限
                    setTimeout(() => {
                        location.reload();
                    }, 1000);
                }
            } catch (error) {
                console.error('检查支付状态失败:', error);
            }
        }, 3000);

        // 5分钟后停止轮询
        setTimeout(() => {
            clearInterval(interval);
        }, 300000);
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
        openModal,
        closeModal,
        buy
    };
})();
