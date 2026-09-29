
let robotBasicData = null
let enable_insertion = 0
let robot_radius= 0
let tool_radius= 0
let coverage_direction
let clean_mode= 0
let point_spacing= 0

async function loadRobotData() {
  try {
   const res = await axiosClient.get("param/queryalldata");
    robotBasicData = res.data.data[0];
    if(robotBasicData){
        robot_radius= robotBasicData.robot_radius//机器人半径
        tool_radius= robotBasicData.tool_radius//工具半径
        enable_insertion = robotBasicData.enable_insertion//是否进行边界清扫
        coverage_direction =robotBasicData.coverage_direction//规划方向
        clean_mode= robotBasicData.clean_mode//清扫模式
        point_spacing=robotBasicData.point_spacing//边界点间距
    }else {
      console.warn("未获取到机器人数据");
    }
    console.log(robotBasicData, "111");
  } catch (error) {
    console.log("catch", error);
  }
}



// 页面加载时立即加载数据
window.onload = async function () {
  try {
    await loadRobotData();
    // 初始化其他依赖于机器人数据的功能
    initDependentFeatures();
  } catch (error) {
    console.error("页面初始化失败:", error);
  }
};
// 初始化依赖于机器人数据的功能
function initDependentFeatures() {
  // 这里可以添加需要机器人数据的初始化代码
  updateUIWithRobotData();
  // setupEventListeners();
}

      

async function getRobotParams() {
  await loadRobotData();
  console.log(enable_insertion ,
robot_radius,
tool_radius,
coverage_direction ,
clean_mode,
point_spacing,"64");
  return {
enable_insertion ,
robot_radius,
tool_radius,
coverage_direction ,
clean_mode,
point_spacing
  };
} 


// 根据机器人数据更新UI
function updateUIWithRobotData() {
 
    // 验证数据加载
    console.log("页面加载完成后的数据:", 
      robot_radius, tool_radius, 
      coverage_direction, enable_insertion, 
      point_spacing,clean_mode);
  // 示例：更新设置表单中的值
  // document.getElementById('rotation').value = rotation;
  document.getElementById('robot_radius').value = robot_radius;
  document.getElementById('tool_radius').value = tool_radius;
  document.getElementById('coverage_direction').value = coverage_direction;
  document.getElementById('cleanMode').value = clean_mode;
  document.getElementById('point_spacing').value = point_spacing;
  document.getElementById('enableInsertion').checked = enable_insertion ; 
}

     // 按钮悬停效果和选择框交互
    document.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.classList.add('shadow-lg');
      });
      btn.addEventListener('mouseleave', () => {
        btn.classList.remove('shadow-lg');
      });
    });
    
    document.querySelectorAll('select').forEach(select => {
      select.addEventListener('focus', () => {
        select.parentElement.classList.add('ring-2', 'ring-primary/50');
      });
      select.addEventListener('blur', () => {
        select.parentElement.classList.remove('ring-2', 'ring-primary/50');
      });
    });

    // 弹出框控制逻辑
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeModal = document.getElementById('closeModal');
    const cancelSettings = document.getElementById('cancelSettings');
    const saveSettings = document.getElementById('saveSettings');
    const cleanMode = document.getElementById('cleanMode');

    // 打开弹出框
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('active');
      document.body.style.overflow = 'hidden'; // 防止背景滚动
    });

    // 关闭弹出框的函数
    function closeSettingsModal() {
      settingsModal.classList.remove('active');
      document.body.style.overflow = ''; // 恢复滚动
    }

    // 关闭弹出框的事件
    closeModal.addEventListener('click', closeSettingsModal);
    cancelSettings.addEventListener('click', closeSettingsModal);
    // 点击背景关闭
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    });

    async function getUpdateRobotParams() {
      const params = {
        id : 1,
        enable_insertion : document.getElementById('enableInsertion').checked,
        robot_radius:document.getElementById('robot_radius').value,
        tool_radius:document.getElementById('tool_radius').value,
        coverage_direction :document.getElementById('coverage_direction').value,
        clean_mode:document.getElementById('cleanMode').value,
        point_spacing:document.getElementById('point_spacing').value,
      }
        try {
              const res = await axiosClient.post("param/update", params);
              let flag = res.data.code;
              if (!flag) {
              cocoMessage.success("更新成功");
              } else {
              cocoMessage.error("更新失败");
              }
          } catch (error) {
              console.error("Error updating data:", error); // 打印完整的错误信息
          }
}
    // 保存设置
    saveSettings.addEventListener('click', () => {
      closeSettingsModal();
      getUpdateRobotParams()
      // 这里可以添加保存设置的逻辑
    });
    
    // 清扫模式变更事件
    cleanMode.addEventListener('change', () => {
        if(cleanMode.value == 0){
            document.getElementById('insertionParams').style.display = 'block';
        } else{
            document.getElementById('insertionParams').style.display = 'none';
        }
    });
    
    // 初始化清扫模式相关参数的显示状态
    if(cleanMode.value == 0){
        document.getElementById('insertionParams').style.display = 'block';
    } else{
        document.getElementById('insertionParams').style.display = 'none';
    }

    