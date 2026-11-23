import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
  // 收据归档文件静态服务：代理到后端
  '/receipts': {
    target: 'http://localhost:8000',
    changeOrigin: true,
  },
}

// 生产构建必须显式提供 API 地址（Cloudflare Pages 项目的 Variables and secrets），
// 缺失时让构建失败：Pages 不会用失败的构建替换线上版本，比悄悄连错后端安全。
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build' && !env.VITE_API_BASE_URL) {
    throw new Error('缺少环境变量 VITE_API_BASE_URL（生产构建必须设置，见 .env.example）')
  }
  return {
  plugins: [react()],
  server: {
    port: 5174,
    proxy: apiProxy,
  },
  // preview.proxy 确保 `vite preview`（生产模式）同样能正确转发 API 请求
  preview: {
    port: 5174,
    proxy: apiProxy,
    allowedHosts: true,
  },
  }
})
