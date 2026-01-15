import Layout from "../layout/Layout";

export default function Profile() {
  return (
    <Layout>
      <div className="p-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">My Profile</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">User details will go here...</p>
      </div>
    </Layout>
  );
}
