import { Navigate } from "react-router-dom";
import Layout from "../layout/Layout";
import DashboardContent from "../components/Dashboard";

export default function Dashboard() {
  if (localStorage.getItem('loginType') === 'customer') {
    return <Navigate to="/cust/dashboard" replace />;
  }

  return (
    <Layout>
      <DashboardContent />
    </Layout>
  );
}
