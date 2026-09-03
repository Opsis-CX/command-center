import NotificationBell from './components/NotificationBell'
import HeaderTaskBar from './components/HeaderTaskBar'
import { useState, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { initTheme } from './lib/theme'
import { supabase } from './lib/supabase'
import ChangePassword from './components/ChangePassword'
import { useAuth } from './lib/auth'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Certifications from './modules/Certifications'
import MyCertifications from './modules/MyCertifications'
import MyCourses from './modules/MyCourses'
import Dashboard from './modules/Dashboard'
import { Placeholder } from './modules/Placeholders'

// Shown instead of a page when the signed-in role isn't allowed to see it.
// Previously these routes simply weren't registered, so a denied user fell
// through to "*" and landed on the Dashboard with no explanation — which reads
// as "the app is broken" rather than "you don't have access".
const NoAccess = () => (
  <Placeholder
    title="No access"
    note="You don't have access to this area. If you think that's wrong, contact an admin."
  />
)
import PeopleTags from './modules/PeopleTags'
import CourseBuilder from './modules/CourseBuilder'
import Schedule from './modules/Schedule'
import ScheduleBuilder from './modules/ScheduleBuilder'
import Positions from './modules/Positions'
import ScheduleInsights from './modules/ScheduleInsights'
import Chat from './modules/Chat'
import { canAny } from './lib/permissions'
import Settings from './modules/Settings'
import RolesPermissions from './modules/RolesPermissions'
import Projects from './modules/Projects'
import Clients from './modules/Clients'
import Reporting from './modules/Reporting'
import HourlyReports from './modules/HourlyReports'
import Updates from './modules/Updates'
import OpsisWeekly from './modules/OpsisWeekly'
import Notes from './modules/Notes'
import Calendar from './modules/Calendar'
import WeeklySync from './modules/WeeklySync'
import Notifications from './modules/Notifications'
import KnowledgeBase from './modules/KnowledgeBase'
import Scorecard from './modules/Scorecard'
import QualityAudit from './modules/QualityAudit'
import CallQA from './modules/CallQA'
import HelpCenter from './modules/HelpCenter'
import Coaching from './modules/Coaching'
import Tokens from './modules/Tokens'
import TeamFavorites from './modules/TeamFavorites'
import Meetings from './modules/Meetings'
import TimeAdmin from './modules/TimeAdmin'
import NewHireSurvey from './modules/NewHireSurvey'
// --- Who's On: live check-ins (LiveStatus) + Slack-style team presence board ---
import LiveStatus from './modules/LiveStatus'
import { usePresenceHeartbeat, MyStatusButton, TeamStatus } from './components/Presence'
import MeetingReminder from './components/MeetingReminder'
import { UnreadProvider } from './lib/unread'
// --- hiring pipeline ---
import ApplicationForm from './modules/ApplicationForm'
import AssessmentForm from './modules/AssessmentForm'
import HiringDashboard from './modules/HiringDashboard'
import MockCallScheduler from './modules/MockCallScheduler'
import TradeBoardChannel from './modules/TradeBoardChannel'
// --- sales pipeline ---
import SalesDashboard from './modules/SalesDashboard'
// Website chat inbox - conversations from opsiscx.com, where Turri hands off
// to a person. Gated by the 'web_chat' page-key in lib/permissions.js.
import WebChat from './modules/WebChat'
// --- RSN pipeline (tag/role-gated variant of Sales with LinkedIn stages) ---
import RsnPipeline from './modules/RsnPipeline'
import { useRsnAccess } from './lib/rsnAccess'
// A tiny wrapper so the assessment route can read :appId from the URL and
// pass it into the form as a prop.
import { useParams } from 'react-router-dom'
function AssessmentRoute() {
  const { appId } = useParams()
  return <AssessmentForm applicationId={appId} />
}
// Public fallback for the old emailed /mock-call/:appId link. The normal path
// is now the "Schedule my mock call" tab inside the onboarding shell — by this
// stage candidates have a Command Center login, so they book there the same way
// they do their certification.
function MockCallRoute() {
  const { appId } = useParams()
  return <MockCallScheduler appId={appId} />
}
// Who's On — live check-in / current-task view (LiveStatus, shift-based) PLUS the
// team presence board (who's online, self-set status, OOO). LiveStatus self-scopes:
// admins/managers see the whole team. Gated by the 'live_status' page-key.
function LiveStatusPage() {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h1 className="page-title">Who's On</h1>
        <p className="page-sub">Live check-ins and what each person is working on right now.</p>
      </div>
      <LiveStatus />
      <div style={{ marginTop: 28, marginBottom: 12 }}>
        <h2 className="page-title" style={{ fontSize: 20 }}>Team status</h2>
        <p className="page-sub">Who's online, everyone's self-set status, and who's out of office. Set your own from the button up top.</p>
      </div>
      <TeamStatus />
    </div>
  )
}
export default function App() {
  const { session, loading, isAdmin, appRole, clientId, inTraining } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  // apply the saved light/dark/system theme as early as possible
  useEffect(() => { initTheme() }, [])
  if (loading) return <div className="loading-screen">Loading…</div>
  // ---- PUBLIC routes (no login required) ----
  // These must be checked BEFORE the login gate so job applicants who aren't
  // signed in can reach the application and assessment forms.
  const publicPaths = ['/apply', '/assessment']
  const isPublic = publicPaths.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))
  // /mock-call is public ONLY for someone with no session at all (the legacy
  // emailed link). Anyone signed in — client portal, trainee, staff — must fall
  // through to their own shell below, so this can never pre-empt the
  // appRole === 'client' gate.
  const isMockPublic = !session && (location.pathname === '/mock-call' || location.pathname.startsWith('/mock-call/'))
  if (isPublic || isMockPublic) {
    return (
      <Routes>
        <Route path="/apply" element={<ApplicationForm />} />
        <Route path="/assessment/:appId" element={<AssessmentRoute />} />
        <Route path="/assessment" element={<AssessmentForm />} />
        <Route path="/mock-call/:appId" element={<MockCallRoute />} />
        <Route path="/mock-call" element={<Login />} />
      </Routes>
    )
  }
  if (!session) return <Login />
  // External client-portal login: a branded, single-purpose shell that shows ONLY
  // Call QA (their own data, RLS-enforced — CallRail/LightSpeed only, never Five9).
  // No sidebar, no other modules.
  if (appRole === 'client') return <ClientPortal session={session} clientId={clientId} />
  // New hires in the pipeline are locked to a Certification-only view until an
  // admin marks them Hired (which clears in_training). No sidebar, no other modules.
  if (inTraining) return <TraineePortal session={session} />
  return <AuthedApp session={session} isAdmin={isAdmin} appRole={appRole} navOpen={navOpen} setNavOpen={setNavOpen} location={location} />
}
// External client portal — a branded, single-page shell that renders ONLY the
// Call QA module in portal mode. Clients see their own calls (RLS-enforced),
// can export and add notes, but never manager controls or any other module.
function ClientPortal({ session, clientId }) {
  const { signOut, user } = useAuth()   // user is needed by PushEnrollmentBanner below
  const [brand, setBrand] = useState(null)          // { portal_name, portal_accent, portal_logo_url, name }
  const [mustChange, setMustChange] = useState(null) // null = still checking

  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) })
    return () => { active = false }
  }, [session.user.id])

  useEffect(() => {
    let active = true
    if (!clientId) { setBrand({}); return }
    supabase.from('clients').select('name, portal_name, portal_accent, portal_logo_url').eq('id', clientId).maybeSingle()
      .then(({ data }) => { if (active) setBrand(data || {}) })
      .catch(() => { if (active) setBrand({}) })
    return () => { active = false }
  }, [clientId])

  if (mustChange === null || brand === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />

  const accent = brand.portal_accent || '#0f766e'
  const name = brand.portal_name || brand.name || 'Call QA'
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{ background: accent, color: '#fff', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {brand.portal_logo_url
            ? <img src={brand.portal_logo_url} alt={name} style={{ height: 32, width: 'auto', borderRadius: 4, background: '#fff', padding: 2 }} />
            : <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.3 }}>{name}</div>}
          <span style={{ fontSize: 13, opacity: 0.85 }}>Call Quality &amp; Conversion</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{session.user.email}</span>
          <button onClick={() => signOut()} style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign out</button>
        </div>
      </header>
      <CallQA portal />
      <footer style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0 32px' }}>Powered by Opsis CX</footer>
    </div>
  )
}
// New-hire onboarding shell — a Certification-only view. New hires keep their agent
// account (so certification data works exactly as it does for agents) but are locked
// here — no sidebar, no other modules — until an admin marks them Hired, which clears
// in_training (finish_onboarding). Questions route to onboarding@opsiscx.com.
function TraineePortal({ session }) {
  const { signOut } = useAuth()
  const [tab, setTab] = useState('certs')
  const [mustChange, setMustChange] = useState(null)
  // Is this person at the mock-call step? If so they get a booking tab here —
  // same place they do their certification, no separate link to keep track of.
  const [mock, setMock] = useState(null)   // {ok, status, booked, provider_name}
  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) })
    return () => { active = false }
  }, [session.user.id])
  useEffect(() => {
    let active = true
    supabase.rpc('get_my_mock_application')
      .then(({ data }) => {
        if (!active) return
        setMock(data || { ok: false })
        // Land straight on booking when that's the step they're on — either
        // because they followed the email link or because it's simply what's
        // next for them.
        if (data?.ok && !data?.booked) setTab('mock')
      })
      .catch(() => { if (active) setMock({ ok: false }) })
    return () => { active = false }
  }, [session.user.id])
  // 2026-09-03 (Becky): once the certification is PASSED, a hire may start
  // taking intervals ("nesting") before the pipeline reaches Hired — so the
  // Schedule and Trade Board unlock here. Everything else stays locked.
  const [certPassed, setCertPassed] = useState(false)
  useEffect(() => {
    let active = true
    supabase.from('agent_cert_records').select('id').eq('profile_id', session.user.id).eq('status', 'passed').limit(1)
      .then(({ data }) => { if (active) setCertPassed(!!(data && data.length)) })
      .catch(() => {})
    return () => { active = false }
  }, [session.user.id])
  if (mustChange === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ background: tab === k ? '#0077B6' : 'transparent', color: tab === k ? '#fff' : '#0f172a', border: '1px solid #0077B6', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>{label}</button>
  )
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{ background: '#0077B6', color: '#fff', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Opsis Command Center</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{session.user.email}</span>
          <button onClick={() => signOut()} style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign out</button>
        </div>
      </header>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 16px 40px' }}>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>
          {mock?.ok && !mock?.booked
            ? <>🎧 You're almost done! Your last step is a <strong>mock call</strong> with {mock.provider_name || 'our team'} — pick a time on the <strong>Schedule my mock call</strong> tab below.</>
            : mock?.ok && mock?.booked
              ? <>🎧 Your <strong>mock call</strong> is booked — see the details on the <strong>My mock call</strong> tab below.</>
              : <>👋 Welcome! Your first step is <strong>certification</strong> — complete it below to move forward in onboarding. The rest of Command Center unlocks once you're all set.</>}
          <div style={{ marginTop: 6 }}>Questions? Email <a href="mailto:onboarding@opsiscx.com" style={{ color: '#1d4ed8', fontWeight: 600 }}>onboarding@opsiscx.com</a>.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {tabBtn('certs', 'My Certifications')}
          {tabBtn('courses', 'My Courses')}
          {mock?.ok && tabBtn('mock', mock?.booked ? '🎧 My mock call' : '🎧 Schedule my mock call')}
          {certPassed && tabBtn('schedule', '◷ Schedule')}
          {certPassed && tabBtn('trades', '🔁 Trade Board')}
        </div>
        {certPassed && (tab === 'schedule' || tab === 'trades') && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#14532d', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
            🎉 Certification passed — you can pick up intervals while you finish onboarding. Accepting an interval is a commitment to service it.
          </div>
        )}
        {tab === 'mock' ? <MockCallScheduler embedded />
          : tab === 'schedule' && certPassed ? <Schedule />
          : tab === 'trades' && certPassed ? <TradeBoardChannel />
          : tab === 'certs' ? <MyCertifications /> : <MyCourses />}
      </div>
      <footer style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0 32px' }}>Opsis CX</footer>
    </div>
  )
}
// Everything behind the login gate. Split out so the must-change-password
// check can run with a session guaranteed to exist.
function AuthedApp({ session, isAdmin, appRole, navOpen, setNavOpen, location }) {
  // RSN pipeline visibility — DB-gated (admins, marketing role, or 'access/rsn' tag).
  const rsnOk = useRsnAccess()
  // Presence heartbeat — quietly marks this user online while the app is open
  // (feeds the Who's On page and presence dots).
  usePresenceHeartbeat()
  // Agents handed the shared temporary password must set their own before
  // they can use the app. Checked once, on load.
  const [mustChange, setMustChange] = useState(null) // null = still checking
  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) }) // never lock someone out on an error
    return () => { active = false }
  }, [session.user.id])
  if (mustChange === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />
  return (
    <UnreadProvider>
      {/* Full-screen meeting alert at T-10 and T-2. Internal staff only —
          it sits inside AuthedApp, which the client portal never reaches. */}
      <MeetingReminder />
      <div className="app">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        {/* tap-to-close backdrop, only visible on mobile when the nav is open */}
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        <main className="main">
          <div className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="nav-toggle" onClick={() => setNavOpen(o => !o)} aria-label="Menu">☰</button>
              <div className="crumb"><b>{titleFor(location.pathname)}</b></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MyStatusButton />
              <HeaderTaskBar />
              <NotificationBell />
            </div>
          </div>
          <div className="content">
            <Routes>
              <Route path="/" element={canAny(appRole, 'dashboard') ? <Dashboard /> : <OpsisWeekly />} />
              <Route path="/calendar" element={<Calendar />} />
              {/* Mock-call booking for anyone signed in but no longer in_training
                  (e.g. unlocked early) — trainees get it as a tab instead. */}
              <Route path="/mock-call" element={<MockCallScheduler embedded />} />
              <Route path="/mock-call/:appId" element={<MockCallRoute />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/roles" element={isAdmin ? <RolesPermissions /> : <NoAccess />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              <Route path="/scorecard" element={canAny(appRole, 'service_performance_scorecard') ? <Scorecard /> : <NoAccess />} />
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/quality" element={(canAny(appRole, 'quality_audit.view_own') || canAny(appRole, 'quality_audit.call_reviews')) ? <QualityAudit /> : <NoAccess />} />
              {/* Internal Call QA (AI) — full manager view incl. Rubric, all campaigns (GarageCo / Lavin / Open Invoices). */}
              <Route path="/call-qa" element={canAny(appRole, 'quality_audit.call_reviews') ? <CallQA /> : <NoAccess />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/chat" element={canAny(appRole, 'chat') ? <Chat /> : <NoAccess />} />
              <Route path="/certifications" element={canAny(appRole, 'certifications.all') ? <Certifications /> : <NoAccess />} />
              <Route path="/courses" element={canAny(appRole, 'certifications.builder') ? <CourseBuilder /> : <NoAccess />} />
              <Route path="/my-certifications" element={canAny(appRole, 'certifications.assigned_to_complete') ? <MyCertifications /> : <NoAccess />} />
              <Route path="/my-courses" element={canAny(appRole, 'certifications.assigned_to_complete') ? <MyCourses /> : <NoAccess />} />
              <Route path="/projects" element={canAny(appRole, 'project_management') ? <Projects /> : <NoAccess />} />
              <Route path="/clients" element={canAny(appRole, 'clients.view_only') ? <Clients /> : <NoAccess />} />
              <Route path="/updates" element={<Updates />} />
              <Route path="/home" element={<OpsisWeekly />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/coaching" element={canAny(appRole, 'coaching') ? <Coaching /> : <NoAccess />} />
              <Route path="/meetings" element={canAny(appRole, 'meetings') ? <Meetings /> : <NoAccess />} />
              <Route path="/live" element={canAny(appRole, 'live_status') ? <LiveStatusPage /> : <NoAccess />} />
              {/* Time (admin) — find/adjust anyone's tracked time, stop runaway timers.
                  The Sidebar has linked here since the module landed, but the route was
                  never registered, so /time fell through to "*" and rendered Dashboard.
                  TimeAdmin re-checks isAdmin itself and RLS enforces it server-side. */}
              <Route path="/time" element={<TimeAdmin />} />
              {/* New Hire Survey — open to any signed-in user. Agents arrive from the
                  notification link and see only the form; admins/reporting also get
                  the aggregate results below it. Responses are anonymous by DB design. */}
              <Route path="/survey" element={<NewHireSurvey />} />
              <Route path="/tokens" element={canAny(appRole, 'tokens') ? <Tokens /> : <NoAccess />} />
              <Route path="/get-to-know-you" element={<TeamFavorites />} />{/* everyone; RLS lets you write only your own card */}
              <Route path="/reporting" element={canAny(appRole, 'reporting') ? <Reporting /> : <NoAccess />} />
              <Route path="/reporting/hourly" element={canAny(appRole, 'reporting') ? <HourlyReports /> : <NoAccess />} />
              <Route path="/people" element={canAny(appRole, 'people_and_tags.view_only') ? <PeopleTags /> : <NoAccess />} />
              <Route path="/hiring" element={canAny(appRole, 'hiring') ? <HiringDashboard /> : <NoAccess />} />
              {/* Sales pipeline. Gated by the 'sales' page-key — add it to lib/permissions.js
                  and grant it to the right roles, exactly like 'hiring'. To open it to
                  everyone temporarily, replace this line with:
                  <Route path="/sales" element={<SalesDashboard />} /> */}
              <Route path="/sales" element={canAny(appRole, 'sales') ? <SalesDashboard /> : <NoAccess />} />
              {/* Website chat inbox. Same audience as Sales - a website visitor is a
                  prospect. The database gate is can_see_sales_pipeline(), so keep the
                  'web_chat' page-key in step with it or the page loads empty. */}
              <Route path="/web-chat" element={canAny(appRole, 'web_chat') ? <WebChat /> : <NoAccess />} />
              {/* RSN pipeline — gated by can_access_rsn_pipeline() (RsnPipeline re-checks on direct hits). */}
              <Route path="/rsn" element={rsnOk ? <RsnPipeline /> : <NoAccess />} />
              <Route path="/weekly-sync" element={canAny(appRole, 'weekly_sync') ? <WeeklySync /> : <NoAccess />} />
              <Route path="/schedule-builder" element={canAny(appRole, 'schedule.create_schedules') ? <ScheduleBuilder /> : <NoAccess />} />
              <Route path="/positions" element={canAny(appRole, 'positions.view_only') ? <Positions /> : <NoAccess />} />
              <Route path="/insights" element={(canAny(appRole, 'schedule.all') || canAny(appRole, 'schedule.view_insights_assigned')) ? <ScheduleInsights /> : <NoAccess />} />
              <Route path="*" element={canAny(appRole, 'dashboard') ? <Dashboard /> : <OpsisWeekly />} />
            </Routes>
          </div>
        </main>
      </div>
    </UnreadProvider>
  )
}
function titleFor(path) {
  const map = {
    '/': 'Dashboard', '/certifications': 'Certifications',
    '/courses': 'Course builder', '/projects': 'Project Management', '/clients': 'Clients', '/people': 'People & tags',
    '/my-certifications': 'My certifications', '/my-courses': 'My courses', '/schedule': 'Schedule',
    '/chat': 'Chat', '/updates': 'Updates', '/home': 'Opsis Weekly', '/notes': 'My Notes', '/schedule-builder': 'Schedule builder', '/positions': 'Positions', '/insights': 'Schedule insights', '/reporting': 'Reporting', '/reporting/hourly': 'Hourly Reports', '/weekly-sync': 'Weekly Sync',
    '/hiring': 'Hiring', '/sales': 'Sales', '/help': 'Help Center', '/roles': 'Roles & permissions',
    '/web-chat': 'Web Chat',
    '/coaching': 'Coaching', '/tokens': 'Tokens', '/get-to-know-you': 'Get to Know You', '/call-qa': 'Call QA (AI)', '/rsn': 'RSN Pipeline', '/meetings': 'Meetings', '/live': "Who's On", '/mock-call': 'Mock call', '/time': 'Time', '/survey': 'New Hire Survey',
  }
  return map[path] || 'Command Center'
}
