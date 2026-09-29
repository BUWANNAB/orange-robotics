document.addEventListener('DOMContentLoaded', () => {
    function setupProgress(wrapperId, progressBarId, progressFillId, progressThumbId, decreaseButtonId, increaseButtonId, percentageDisplayId) {
        const progressBar = document.getElementById(progressBarId);
        const progressFill = document.getElementById(progressFillId);
        const progressThumb = document.getElementById(progressThumbId);
        const decreaseButton = document.getElementById(decreaseButtonId);
        const increaseButton = document.getElementById(increaseButtonId);
        const percentageDisplay = document.getElementById(percentageDisplayId);
  
        let isDragging = false;
        let startX, startWidth;
  
        // 从localStorage读取进度
        const savedPercentage = localStorage.getItem(`progress${wrapperId}`);
        let currentPercentage = savedPercentage ? parseInt(savedPercentage) : 20; // 初始值设为20%
        window[`globalPercentage${wrapperId}`] = currentPercentage;
  
        // 更新进度条
        function updateProgress(newWidth) {
            newWidth = Math.max(0, Math.min(newWidth, progressBar.offsetWidth - progressThumb.offsetWidth));
            progressFill.style.width = `${newWidth}px`;
            progressThumb.style.left = `${newWidth}px`;
  
            // 计算百分比
            const percentage = Math.round((newWidth / (progressBar.offsetWidth - progressThumb.offsetWidth)) * 100);
            window[`globalPercentage${wrapperId}`] = percentage;
            percentageDisplay.textContent = `${percentage}%`;
  
            // 保存进度到localStorage
            localStorage.setItem(`progress${wrapperId}`, percentage);
        }
  
        function handleStart(e) {
            e.preventDefault();
            isDragging = true;
            startX = e.clientX || e.touches[0].clientX;
            startWidth = progressFill.offsetWidth;
        }
  
        function handleMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            const dx = (e.clientX || e.touches[0].clientX) - startX;
            const newWidth = startWidth + dx;
            updateProgress(newWidth);
        }
  
        function handleEnd(e) {
            isDragging = false;
        }
  
        function increaseProgress() {
            const currentWidth = progressFill.offsetWidth;
            const newWidth = Math.min(currentWidth + 10, progressBar.offsetWidth - progressThumb.offsetWidth);
            updateProgress(newWidth);
        }
  
        function decreaseProgress() {
            const currentWidth = progressFill.offsetWidth;
            const newWidth = Math.max(currentWidth - 10, 0);
            updateProgress(newWidth);
        }
  
        // 初始化进度条
        const initialWidth = (currentPercentage / 100) * (progressBar.offsetWidth - progressThumb.offsetWidth);
        updateProgress(initialWidth);
  
        progressThumb.addEventListener('mousedown', handleStart);
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);
  
        // 触摸事件支持
        progressThumb.addEventListener('touchstart', handleStart);
        document.addEventListener('touchmove', handleMove);
        document.addEventListener('touchend', handleEnd);
  
        decreaseButton.addEventListener('click', decreaseProgress);
        increaseButton.addEventListener('click', increaseProgress);
    }
  
    // 初始化两个进度条
    setupProgress(1, 'progressBar1', 'progressFill1', 'progressThumb1', 'decreaseButton1', 'increaseButton1', 'percentageDisplay1');
    setupProgress(2, 'progressBar2', 'progressFill2', 'progressThumb2', 'decreaseButton2', 'increaseButton2', 'percentageDisplay2');
  });