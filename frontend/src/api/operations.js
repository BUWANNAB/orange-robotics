/* Reuse the site's authenticated axios client; keep all HTTP calls in src/api. */
(function () {
  async function request(method, path, data, config = {}) {
    try {
      const response = await window.axiosClient.request({ method, url: path, data, ...config });
      if (config.responseType === 'blob') return response.data;
      if (response.data.code !== 0) throw new Error(response.data.message || '请求失败');
      return response.data.data;
    } catch (error) {
      const detail = error.response?.data?.detail;
      throw new Error(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : error.response?.data?.message || error.message);
    }
  }
  window.OpsAPI = {
    get: (path, params) => request('GET', path, undefined, { params }),
    post: (path, data = {}) => request('POST', path, data),
    put: (path, data) => request('PUT', path, data),
    delete: (path, params) => request('DELETE', path, undefined, { params }),
    upload: (path, data, params) => request('POST', path, data, { params, headers: { 'Content-Type': 'application/octet-stream' } }),
    chunk: (id, index, data) => request('PUT', `/api/firmware/${id}/chunks/${index}`, data, { headers: { 'Content-Type': 'application/octet-stream' } }),
    download: (path, params) => request('GET', path, undefined, { params, responseType: 'blob' })
  };
})();
