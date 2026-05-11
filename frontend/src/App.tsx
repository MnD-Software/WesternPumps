import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Grid, Layout, Space, Switch, Tooltip, Typography } from "antd";
import { BulbOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import type { UserPreferences } from "./api/types";
import { useAuth } from "./state/AuthContext";
import { useThemeMode } from "./state/ThemeContext";
import logoMark from "./assets/image.png";
import { getBrandingSettings } from "./api/settings";
import { getMyPreferences } from "./api/users";
import { allowedLandingPages, canAccessPage, type AppPageKey } from "./utils/access";
import BrandedLoader from "./components/BrandedLoader";
import DesktopLayout from "./layouts/DesktopLayout";
import MobileLayout from "./layouts/MobileLayout";
import MobileSidebar from "./components/MobileSidebar";
import { pageVariants } from "./utils/motion";

const NavBar = lazy(() => import("./components/NavBar"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const ConsolePage = lazy(() => import("./pages/ConsolePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const DeliveriesPage = lazy(() => import("./pages/DeliveriesPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const OperationsPage = lazy(() => import("./pages/OperationsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const CategoriesPage = lazy(() => import("./pages/CategoriesPage"));
const LocationsPage = lazy(() => import("./pages/LocationsPage"));
const RequestsPage = lazy(() => import("./pages/RequestsPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const StoreManagerReportsPage = lazy(() => import("./pages/StoreManagerReportsPage"));
const LeadTechReportsPage = lazy(() => import("./pages/LeadTechReportsPage"));
const TechnicianReportsPage = lazy(() => import("./pages/TechnicianReportsPage"));
const VerifyItemPage = lazy(() => import("./pages/VerifyItemPage"));
const AdminSettingsPage = lazy(() => import("./pages/AdminSettingsPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const InventorySciencePage = lazy(() => import("./pages/InventorySciencePage"));
const PlatformPage = lazy(() => import("./pages/PlatformPage"));
const WorkflowPage = lazy(() => import("./pages/WorkflowPage"));
const ReportsV2Page = lazy(() => import("./pages/ReportsV2Page"));
const SystemGuidePage = lazy(() => import("./pages/SystemGuidePage"));
const InventoryGuidePage = lazy(() => import("./pages/InventoryGuidePage"));
const MySettingsPage = lazy(() => import("./pages/MySettingsPage"));
const MyZonesPage = lazy(() => import("./pages/MyZonesPage"));
const NotificationBar = lazy(() => import("./components/NotificationBar"));
const RecentActivityBar = lazy(() => import("./components/RecentActivityBar"));

const disableAuth = import.meta.env.VITE_DISABLE_AUTH === "true";
const { Sider } = Layout;

function Protected({ children }: { children: JSX.Element }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!disableAuth && user?.must_change_password) return <Navigate to="/my-settings?force_password_change=1" replace />;
  return children;
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isAdmin, loadingUser, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loadingUser) {
    return (
      <div className="container">
        <BrandedLoader compact title="Loading access" subtitle="Checking administrator permissions..." />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/customers" replace />;
  if (user?.must_change_password) return <Navigate to="/my-settings?force_password_change=1" replace />;
  return children;
}

function ManagerOnly({ children }: { children: JSX.Element }) {
  const { isAuthenticated, user, loadingUser, isAdmin } = useAuth();
  if (disableAuth) return children;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loadingUser) {
    return (
      <div className="container">
        <BrandedLoader compact title="Loading access" subtitle="Checking manager permissions..." />
      </div>
    );
  }
  const role = user?.role ?? "technician";
  if (user?.must_change_password) return <Navigate to="/my-settings?force_password_change=1" replace />;
  if (!(isAdmin || role === "manager")) return <Navigate to="/dashboard" replace />;
  return children;
}

function InventoryOnly({ children }: { children: JSX.Element }) {
  const { isAuthenticated, user, loadingUser, isAdmin } = useAuth();
  if (disableAuth) return children;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loadingUser) {
    return (
      <div className="container">
        <BrandedLoader compact title="Loading access" subtitle="Checking inventory permissions..." />
      </div>
    );
  }
  const role = user?.role ?? "technician";
  if (user?.must_change_password) return <Navigate to="/my-settings?force_password_change=1" replace />;
  if (!(isAdmin || role === "store_manager" || role === "manager")) return <Navigate to="/dashboard" replace />;
  return children;
}

function ApproverOnly({ children }: { children: JSX.Element }) {
  const { isAuthenticated, user, loadingUser, isAdmin } = useAuth();
  if (disableAuth) return children;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loadingUser) {
    return (
      <div className="container">
        <BrandedLoader compact title="Loading access" subtitle="Checking approval permissions..." />
      </div>
    );
  }
  const role = user?.role ?? "technician";
  if (user?.must_change_password) return <Navigate to="/my-settings?force_password_change=1" replace />;
  if (!(isAdmin || role === "manager" || role === "approver")) return <Navigate to="/requests" replace />;
  return children;
}

function AccessOnly({ page, children }: { page: AppPageKey; children: JSX.Element }) {
  const { isAuthenticated, user, loadingUser } = useAuth();
  if (disableAuth) return children;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loadingUser) {
    return (
      <div className="container">
        <BrandedLoader compact title="Loading access" subtitle={`Opening ${page}...`} />
      </div>
    );
  }
  if (page !== "my_settings" && user?.must_change_password) {
    return <Navigate to="/my-settings?force_password_change=1" replace />;
  }
  if (!canAccessPage(user?.role, page)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { isAuthenticated, user, logout } = useAuth();
  const { isDarkMode, toggleTheme } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
const [collapsed, setCollapsed] = useState(false);
const [drawerOpen, setDrawerOpen] = useState(false);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const showShell = disableAuth || isAuthenticated;
  const isMobileViewport = !screens.md;
  const fallbackLabel = user?.full_name || user?.email || "";
  const userLabel = preferences?.display_name_override?.trim() || fallbackLabel;
  const showEmailInHeader = preferences?.show_email_in_header ?? true;
  const logoSrc = !logoLoadFailed && brandingLogoUrl ? brandingLogoUrl : logoMark;
  const role = user?.role ?? "technician";
  const defaultHome = preferences?.default_landing_page && allowedLandingPages(role).includes(preferences.default_landing_page)
    ? preferences.default_landing_page
    : user?.must_change_password
      ? "/my-settings?force_password_change=1"
      : "/dashboard";

  useEffect(() => {
    if (isMobileViewport) setCollapsed(true);
  }, [isMobileViewport]);

  useEffect(() => {
    let mounted = true;
    getBrandingSettings()
      .then((res) => {
        if (!mounted) return;
        setLogoLoadFailed(false);
        setBrandingLogoUrl(res.branding_logo_url || "");
      })
      .catch(() => {
        if (!mounted) return;
        setLogoLoadFailed(false);
        setBrandingLogoUrl("");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!showShell) {
      setPreferences(null);
      return;
    }
    if (!disableAuth && !isAuthenticated) {
      setPreferences(null);
      return;
    }
    // Reset in-memory preferences when account context changes to avoid cross-user UI bleed.
    setPreferences(null);
    let active = true;
    getMyPreferences()
      .then((prefs) => {
        if (!active) return;
        setPreferences(prefs);
      })
      .catch(() => {
        if (!active) return;
        setPreferences(null);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, showShell, user?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const flag = sessionStorage.getItem("wp_show_welcome_loader");
    if (flag !== "1") return;
    sessionStorage.removeItem("wp_show_welcome_loader");
    setWelcomeLoading(true);
    const timer = window.setTimeout(() => setWelcomeLoading(false), 1300);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated]);

  const headerNode = (
    <div className="app-header-inner">
      <Space className="app-header-left">
        {showShell && isMobileViewport ? (
          <Button
            type="text"
            icon={<MenuFoldOutlined />}
            aria-label="Open navigation menu"
            onClick={() => setDrawerOpen(true)}
          />
        ) : null}
        {showShell && !isMobileViewport ? (
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((prev) => !prev)}
          />
        ) : null}
        <Typography.Text strong className="app-header-title">
          <Space size={8} align="center">
            <img
              src={logoSrc}
              alt="WesternPumps logo"
              className="app-header-logo"
              onError={() => setLogoLoadFailed(true)}
              loading="eager"
              decoding="async"
            />
            <span>WesternPumps</span>
          </Space>
        </Typography.Text>
      </Space>
      <Space className="app-header-actions">
        {showShell && !disableAuth ? (
          <span className="app-header-tool app-header-tool--notifications">
            <Suspense fallback={null}>
              <NotificationBar />
            </Suspense>
          </span>
        ) : null}
        {showShell && !disableAuth && !isMobileViewport ? (
          <span className="app-header-tool app-header-tool--activity">
            <Suspense fallback={null}>
              <RecentActivityBar />
            </Suspense>
          </span>
        ) : null}
        <Tooltip title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}>
          <Switch
            checked={isDarkMode}
            onChange={toggleTheme}
            checkedChildren={<BulbOutlined />}
            unCheckedChildren={<BulbOutlined />}
            aria-label="Toggle dark mode"
          />
        </Tooltip>
        {showShell && !disableAuth && userLabel && !isMobileViewport ? (
          <Typography.Text type="secondary" className="app-user-label" title={userLabel}>
            {showEmailInHeader && user?.email ? `${userLabel} (${user.email})` : userLabel}
          </Typography.Text>
        ) : null}
        {showShell && !disableAuth ? (
          <Button
            className="app-logout-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </Button>
        ) : null}
      </Space>
    </div>
  );

  const sidebarNode = showShell ? (
    <Sider
      width={240}
      collapsible
      collapsed={collapsed}
      collapsedWidth={72}
      onCollapse={(value) => setCollapsed(value)}
      trigger={null}
      theme={isDarkMode ? "dark" : "light"}
      className={`app-sider ${collapsed ? "is-collapsed" : "is-expanded"}`}
    >
      <div className="app-sider-brand">
        <Space size={10} align="center" className="app-brand-wrap">
          <img
            src={logoSrc}
            alt="WesternPumps logo"
            className="app-brand-logo"
            onError={() => setLogoLoadFailed(true)}
            loading="eager"
            decoding="async"
          />
          <Typography.Title level={5} className="app-brand" style={{ margin: 0 }}>
            {collapsed ? "WP" : "WesternPumps"}
          </Typography.Title>
        </Space>
      </div>
      <div className="app-sider-nav" aria-label="Sidebar navigation">
        <Suspense
          fallback={
            <div className="container">
              <BrandedLoader compact title="Loading menu" subtitle="Preparing navigation..." />
            </div>
          }
        >
          <NavBar />
        </Suspense>
      </div>
    </Sider>
  ) : null;

  const routesNode = (
    <Suspense
      fallback={
        <div className="container">
          <BrandedLoader compact title="Loading page" subtitle="Rendering page content..." />
        </div>
      }
    >
      <AnimatePresence mode="wait">
        <motion.div
          className="route-transition"
          key={location.pathname}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={pageVariants}
        >
          <Routes location={location}>
          <Route path="/" element={<Navigate to={defaultHome} replace />} />
          <Route path="/" element={<Navigate to={defaultHome} replace />} />
          <Route path="/login" element={disableAuth ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
          <Route path="/verify/:partId" element={<VerifyItemPage />} />
          <Route
            path="/assistant"
            element={
              <AccessOnly page="assistant">
                <AssistantPage />
              </AccessOnly>
            }
          />
          <Route
            path="/console"
            element={
              <AccessOnly page="console">
                <ConsolePage />
              </AccessOnly>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Protected>
                <DashboardPage />
              </Protected>
            }
          />
          <Route
            path="/customers"
            element={
              <AccessOnly page="customers">
                <CustomersPage />
              </AccessOnly>
            }
          />
          <Route
            path="/jobs"
            element={
              <AccessOnly page="jobs">
                <JobsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/deliveries"
            element={
              <AccessOnly page="deliveries">
                <DeliveriesPage />
              </AccessOnly>
            }
          />
          <Route
            path="/guide"
            element={
              <AccessOnly page="guide">
                <SystemGuidePage />
              </AccessOnly>
            }
          />
          <Route
            path="/inventory-guide"
            element={
              <AccessOnly page="inventory_guide">
                <InventoryGuidePage />
              </AccessOnly>
            }
          />
          <Route
            path="/inventory"
            element={
              <AccessOnly page="inventory">
                <InventoryPage />
              </AccessOnly>
            }
          />
          <Route
            path="/operations"
            element={
              <AccessOnly page="operations">
                <OperationsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/categories"
            element={
              <AccessOnly page="categories">
                <CategoriesPage />
              </AccessOnly>
            }
          />
          <Route
            path="/locations"
            element={
              <AccessOnly page="locations">
                <LocationsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/suppliers"
            element={
              <AccessOnly page="suppliers">
                <SuppliersPage />
              </AccessOnly>
            }
          />
          <Route
            path="/requests"
            element={
              <AccessOnly page="requests">
                <RequestsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/approvals"
            element={
              <AccessOnly page="approvals">
                <RequestsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/reports"
            element={
              <AccessOnly page="reports">
                <ReportsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/reports-v2"
            element={
              <AccessOnly page="reports_v2">
                <ReportsV2Page />
              </AccessOnly>
            }
          />
          <Route
            path="/store-manager-reports"
            element={
              <AccessOnly page="store_manager_reports">
                <StoreManagerReportsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/lead-tech-reports"
            element={
              <AccessOnly page="lead_tech_reports">
                <LeadTechReportsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/technician-reports"
            element={
              <AccessOnly page="technician_reports">
                <TechnicianReportsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/audit"
            element={
              <AccessOnly page="audit">
                <AuditPage />
              </AccessOnly>
            }
          />
          <Route
            path="/inventory-science"
            element={
              <AccessOnly page="inventory_science">
                <InventorySciencePage />
              </AccessOnly>
            }
          />
          <Route
            path="/platform"
            element={
              <AccessOnly page="platform">
                <PlatformPage />
              </AccessOnly>
            }
          />
          <Route
            path="/workflow"
            element={
              <AccessOnly page="workflow">
                <WorkflowPage />
              </AccessOnly>
            }
          />
          <Route
            path="/users"
            element={
              <AdminOnly>
                <UsersPage />
              </AdminOnly>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <AccessOnly page="admin_settings">
                <AdminSettingsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/my-settings"
            element={
              <AccessOnly page="my_settings">
                <MySettingsPage />
              </AccessOnly>
            }
          />
          <Route
            path="/my-zones"
            element={
              <AccessOnly page="my_zones">
                <MyZonesPage />
              </AccessOnly>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </motion.div>
        </AnimatePresence>
      </Suspense>
  );

  const appShellClassName = [
    "app-shell",
    preferences?.dense_mode ? "app-density-compact" : "",
    preferences?.animations_enabled === false ? "app-animations-off" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appShellClassName}>
      {welcomeLoading ? (
        <div className="app-welcome-overlay">
          <BrandedLoader title="Welcome to Western Pumps" subtitle="Loading your dashboard..." />
        </div>
      ) : null}
{showShell && isMobileViewport ? (
        <MobileLayout header={headerNode} canViewInventory={canAccessPage(role, "inventory")} drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen(o => !o)}>
          <MobileSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
          {routesNode}
        </MobileLayout>

      ) : showShell ? (
        <DesktopLayout sidebar={sidebarNode} header={headerNode}>
          {routesNode}
        </DesktopLayout>
      ) : (
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Header className="app-header">{headerNode}</Layout.Header>
          <Layout.Content className="app-content">
            <div className="content-shell">{routesNode}</div>
          </Layout.Content>
        </Layout>
      )}
    </div>
  );
}
