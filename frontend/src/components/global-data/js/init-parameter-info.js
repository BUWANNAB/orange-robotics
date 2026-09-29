// 参数信息弹出框初始化脚本
import ParameterInfoModal from './parameter-info-modal.js';

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', function() {
    // 初始化参数信息弹出框
    const paramModal = new ParameterInfoModal();
    
    // 绑定所有参数信息按钮的点击事件
    document.querySelectorAll('.param-info-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const paramName = this.getAttribute('data-param');
            paramModal.show(paramName);
        });
    });
    
    // 将参数信息弹出框实例暴露到全局，以便其他脚本使用
    window.paramInfoModal = paramModal;
});