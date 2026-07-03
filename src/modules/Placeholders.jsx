import { useAuth } from '../lib/auth'

export function Dashboard() {
  const { isAdmin, user } = useAuth()
  const name = user?.email?.split('@')[0] ?? 'there'
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Welcome, {name}</h1>
        <p className="page-sub">
          {isAdmin
            ? "You're signed in as an admin — you can see the full command center."
            : "You're signed in as an agent — your view shows what's relevant to you."}
        </p>
      </div>
      <div className="cards">
        <div className="card">
          <h3 style={{ margin: 0 }}>Certifications</h3>
          <p className="page-sub" style={{ marginTop: 5 }}>
            {isAdmin ? 'Manage certifications and see who has passed.'
                     : 'Complete your assigned certifications to unlock schedules.'}
          </p>
        </div>
        <div className="card">
          <h3 style={{ margin: 0 }}>Schedule</h3>
          <p className="page-sub" style={{ marginTop: 5 }}>Your existing schedule module mounts here next.</p>
        </div>
      </div>
    </div>
  )
}

export function Placeholder({ title, note }) {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{note}</p>
      </div>
      <div className="card">
        <div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>
          This is where your existing <b>{title}</b> module will mount. We migrate
          it in next — same pattern as the Certifications module.
        </div>
      </div>
    </div>
  )
}
