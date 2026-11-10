import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './contexts/AppContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/Login.jsx'
import RegisterPage from './pages/Register.jsx'
import Dashboard from './pages/Dashboard.jsx'
import InvoicesPage from './pages/Invoices.jsx'
import InvoiceEditPage from './pages/InvoiceEdit.jsx'
import InvoiceDetailPage from './pages/InvoiceDetail.jsx'
import ClientsPage from './pages/Clients.jsx'
import ExpensesPage from './pages/Expenses.jsx'
import CommissionsPage from './pages/Commissions.jsx'
import CompanyEditPage from './pages/CompanyEdit.jsx'
import FinancialsPage from './pages/Financials.jsx'
import CompliancePage from './pages/Compliance.jsx'
import HRPage from './pages/HR.jsx'
import LeasesPage from './pages/Leases.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import ForgotPasswordPage from './pages/ForgotPassword.jsx'
import ResetPasswordPage from './pages/ResetPassword.jsx'
import VerifyEmailPage from './pages/VerifyEmail.jsx'

function ProtectedRoutes() {
  const { user, loading } = useApp()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <span className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>載入中...</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/new" element={<InvoiceEditPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/invoices/:id/edit" element={<InvoiceEditPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/commissions" element={<CommissionsPage />} />
        <Route path="/financials" element={<FinancialsPage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/admin" element={user.role === 'admin' ? <AdminPanel /> : <Navigate to="/" />} />
        <Route path="/companies/new" element={<CompanyEditPage />} />
        <Route path="/companies/:id/edit" element={<CompanyEditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/login" element={<LoginPublic />} />
        <Route path="/register" element={<RegisterPublic />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </AppProvider>
  )
}

function LoginPublic() {
  const { user } = useApp()
  if (user) return <Navigate to="/" replace />
  return <LoginPage />
}

function RegisterPublic() {
  const { user } = useApp()
  if (user) return <Navigate to="/" replace />
  return <RegisterPage />
}
