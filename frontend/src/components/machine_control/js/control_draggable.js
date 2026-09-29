function dragMove(id, childId) {
  document.addEventListener('DOMContentLoaded', function() {
    const draggable = document.getElementById(id);
    const container = document.getElementById('container'); // 获取外部容器元素
    let isDragging = false;
    let startX, startY, currentX, currentY;
    let pointerId = null;
    let initialY = null;

    // 计算最大边界
    function updateBounds() {
      const bounds = container.getBoundingClientRect();
      draggable.maxX = bounds.right - draggable.offsetWidth;
      draggable.maxY = bounds.bottom - draggable.offsetHeight;
    }
    // 初始化边界
    updateBounds();

    // 监听容器大小变化
    new ResizeObserver(() => {
      updateBounds();
      setRightMovePosition(); // 更新 #rightmove 的位置
    }).observe(container);
    // 鼠标事件
    draggable.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX - draggable.offsetLeft;
      startY = e.clientY - draggable.offsetTop;
      startDrag(e);
    });

    // 触摸事件
    draggable.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.touches[0].clientX - draggable.offsetLeft;
      startY = e.touches[0].clientY - draggable.offsetTop;
      initialY = e.touches[0].clientY;
      startDrag(e);
    });
    // 开始拖动
    function startDrag(e) {
      if (e.type === 'touchstart' && e.touches.length > 0) {
        isDragging = true;
        draggable.style.cursor = 'grabbing';
        pointerId = e.touches[0].identifier;
        try {
          draggable.setPointerCapture(pointerId);
        } catch (error) {
          console.error(error); // 如果失败，记录错误日志
        }
      } else if (e.type === 'mousedown') {
        isDragging = true;
        draggable.style.cursor = 'grabbing';
      }
    }

    // 拖动中
    function moveElement(e) {
      if (isDragging) {
        e.preventDefault();
        const x = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const y = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
        currentX = x - startX;
        currentY = y - startY;

        // 确保不超出边界
        if (currentX < 0) currentX = 0;
        if (currentX > draggable.maxX) currentX = draggable.maxX;
        if (currentY < 0) currentY = 0;
        if (currentY > draggable.maxY) currentY = draggable.maxY;

        draggable.style.left = `${currentX}px`;
        draggable.style.top = `${currentY}px`;
      }
    }

    draggable.addEventListener('mousemove', moveElement);
    draggable.addEventListener('touchmove', moveElement);

    // 结束拖动
    function endDrag() {
      if (isDragging) {
        isDragging = false;
        draggable.style.cursor = 'pointer';
        if (pointerId !== null) {
          try {
            draggable.releasePointerCapture(pointerId);
          } catch (error) {
            console.error(error); // 如果失败，记录错误日志
          }
          pointerId = null;
        }
        initialY = null;
      }
    }

    draggable.addEventListener('mouseup', endDrag);
    draggable.addEventListener('touchend', endDrag);
    draggable.addEventListener('mouseleave', endDrag);
    draggable.addEventListener('touchcancel', endDrag);

    // 确保子元素的点击事件不会触发父元素的拖动
    const smallBox = document.getElementById(childId);
    smallBox.addEventListener('mousedown', (e) => e.stopPropagation());
    smallBox.addEventListener('touchstart', (e) => e.stopPropagation());
  });
}

// 动态设置 #rightmove 的初始位置
function setRightMovePosition() {
  const rightmove = document.getElementById('rightmove');
  const container = document.getElementById('container');
  const rightmoveWidth = rightmove.offsetWidth;
  const containerWidth = container.offsetWidth;

  rightmove.style.left = `calc(100% - ${rightmoveWidth + 20}px)`; // 20px 是一个额外的间距
}

// 调用函数
dragMove("leftmove", "circleCanvasLeft");
dragMove("rightmove", "circleCanvasRight");
dragMove("leftmove", "progressWrapper1");
dragMove("rightmove", "progressWrapper2");

// 切换容器大小的按钮
function toggleContainerSize() {
  const container = document.getElementById('container');
  container.classList.toggle('expanded');

  // 更新可拖动元素的最大边界
  updateBoundsForAllDraggables();
}

// 更新所有可拖动元素的最大边界
function updateBoundsForAllDraggables() {
  const draggables = document.querySelectorAll('#leftmove, #rightmove');
  draggables.forEach(draggable => {
    const bounds = document.getElementById('container').getBoundingClientRect();
    draggable.maxX = bounds.right - draggable.offsetWidth;
    draggable.maxY = bounds.bottom - draggable.offsetHeight;
  });
}

// 页面加载时设置 #rightmove 的初始位置
document.addEventListener('DOMContentLoaded', () => {
  setRightMovePosition();
});

// 监听窗口大小变化，重新设置 #rightmove 的位置
window.addEventListener('resize', () => {
  setRightMovePosition();
});

