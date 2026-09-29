
    import axiosClient from "../../../../../api/ApiManager.js";

    let allData = [];
    let sortOrder = 'desc';
    let displayedData = [];
    let currentPage = 1;
    let pageSize = parseInt(document.getElementById('pageSize').value);
    let getData = []
    $(document).ready(function () {
        getWaterDepth();
    });

    async function getWaterDepth() {
        try {
            const response = await axiosClient.get("waterdepth/queryall");
            console.log(response.data, "response");
            allData = response.data.data || [];
           // cocoMessage.success("获取数据成功");
            filterTodayData();
        } catch (error) {
            console.error("Error fetching data:", error);
            throw error;
        }
    }

function filterTodayData() {
    const today = new Date().toISOString().split('T')[0];
    displayedData = allData.filter(item => {
        const createTime = new Date(item.createTime).toISOString().split('T')[0];
        return createTime === today;
    });
    sortAndDisplayData(displayedData); // 确保应用排序
}

    function sortAndDisplayData(data) {
        const sortedData = [...data].sort((a, b) => {
            return sortOrder === 'asc' ?
                new Date(a.createTime) - new Date(b.createTime) :
                new Date(b.createTime) - new Date(a.createTime);
        });
        displayData(sortedData);
    }

function displayData() {
    // 根据当前的排序顺序对数据进行排序
    const sortedData = [...displayedData].sort((a, b) => {
        return sortOrder === 'asc' ?
            new Date(a.createTime) - new Date(b.createTime) :
            new Date(b.createTime) - new Date(a.createTime);
    });

    const tbody = document.getElementById('dataTable').getElementsByTagName('tbody')[0];
    tbody.innerHTML = '';
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    // 显示当前页面的数据
    sortedData.slice(start, end).forEach(item => {
        const row = tbody.insertRow();
        row.insertCell(0).innerText = item.longitude;
        row.insertCell(1).innerText = item.latitude;
        row.insertCell(2).innerText = item.depth === "-1.000000" ? '空' : item.depth;
        row.insertCell(3).innerText = new Date(item.createTime).toLocaleString();
    });

    updatePagination(Math.ceil(sortedData.length / pageSize));
}

    function updatePagination(totalPages) {
        const pagination = document.getElementById('pagination');
        pagination.innerHTML = '';
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            addPaginationItem(pagination, 1);
            if(startPage > 2) pagination.appendChild(document.createTextNode('...'));
        }

        for (let i = startPage; i <= endPage; i++) {
            addPaginationItem(pagination, i);
        }

        if (endPage < totalPages) {
            if(endPage < totalPages - 1) pagination.appendChild(document.createTextNode('...'));
            addPaginationItem(pagination, totalPages);
        }
    }

    function addPaginationItem(parent, pageNumber) {
        const listItem = document.createElement('li');
        listItem.className = 'page-item' + (pageNumber === currentPage ? ' active' : '');
        const link = document.createElement('a');
        link.className = 'page-link';
        link.href = '#';
        link.innerText = pageNumber;
        link.onclick = () => { currentPage = pageNumber; displayData(displayedData); };
        listItem.appendChild(link);
        parent.appendChild(listItem);
    }

function filterDataByDate() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
        alert('请选择起始时间和终止时间');
        return;
    }

    displayedData = allData.filter(item => {
        const createTime = new Date(item.createTime).toISOString().split('T')[0];
        return createTime >= startDate && createTime <= endDate;
    });
    currentPage = 1; // Reset to first page after filtering
    sortAndDisplayData(displayedData); // 确保应用排序
}

    document.getElementById("filterData").addEventListener('click', filterDataByDate);

    document.getElementById("exportFilteredData").addEventListener('click', function () {
        exportToExcel(displayedData);
    });

    document.getElementById("exportFilteredDataIcon").addEventListener('click', function () {
        exportToExcel(displayedData);
    });

    function exportToExcel(data) {

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data.reverse().map(item => ({
            '经度 (longitude)': item.longitude,
            '纬度 (latitude)': item.latitude,
            '深度(空为未检测到数据)': item.depth === '-1.000000' ? '空' : item.depth,
            '创建时间 (createTime)': new Date(item.createTime).toLocaleString(),
        })));

        XLSX.utils.book_append_sheet(wb, ws, 'Data');
        XLSX.writeFile(wb, 'filtered_exported_data.xlsx');
    }

// 切换排序顺序时重新排序并显示数据
document.getElementById("toggleSortOrder").addEventListener('click', function () {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    sortAndDisplayData(displayedData); // 当用户切换排序顺序时重新排序并显示
});

    document.getElementById("pageSize").addEventListener('change', function() {
        pageSize = parseInt(this.value);
        currentPage = 1; // Reset to first page when changing page size
        displayData(displayedData);
    });
