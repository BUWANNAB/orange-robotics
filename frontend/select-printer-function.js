// 通用的select值打印函数
// 参数：
// - selectSelector: select元素的选择器，如'#mySelect'或'.mySelect'
// - callback: 可选的回调函数，接收选中值作为参数
function setupSelectPrinter(selectSelector, callback = null) {
    const selectElement = document.querySelector(selectSelector);
    if (!selectElement) {
        console.error(`未找到选择器为"${selectSelector}"的select元素`);
        return;
    }
    
    // 打印函数
    function printValue() {
        const selectedValue = selectElement.value;
        const selectedText = selectElement.options[selectElement.selectedIndex].text;
        const logMessage = `选中的值: ${selectedValue} (${selectedText})`;
        
        // 打印到控制台
        console.log(logMessage);
        
        // 如果有回调函数，调用它
        if (callback) {
            callback(selectedValue, selectedText);
        }
    }
    
    // 保存事件处理函数的引用，以便后续移除
    const handleSelectClick = function() {
        // 直接打印当前选中值
        printValue();
    };
    
    // 监听select的click事件 - 点击选择框时触发
    selectElement.addEventListener('click', handleSelectClick);
    
    console.log(`已为选择器"${selectSelector}"的select元素设置值打印功能`);
    
    // 返回一个对象，包含移除事件监听的方法
    return {
        remove: function() {
            // 移除click事件监听器
            selectElement.removeEventListener('click', handleSelectClick);
            console.log(`已移除选择器"${selectSelector}"的select元素值打印功能`);
        }
    };
}

// 使用示例
// 1. 基本使用：
// setupSelectPrinter('#mySelect');

// 2. 带自定义回调函数：
/*
setupSelectPrinter('#mySelect', function(value, text) {
    console.log('自定义回调 - 值:', value, '文本:', text);
    // 这里可以添加自定义逻辑，比如更新页面内容
    document.getElementById('result').textContent = `你选择了: ${text}`;
});
*/

// 3. 保存返回对象，以便稍后移除事件监听：
/*
const printer = setupSelectPrinter('#mySelect');
// 稍后移除
// printer.remove();
*/