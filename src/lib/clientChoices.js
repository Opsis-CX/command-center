// Clients offered in the TASK MANAGEMENT dropdowns: the timer bar, the task form, the task detail page, recurring tasks and the dashboard filter.
// A client whose "Task management" box is unticked (clients.show_in_tasks = false) is not offered for new choices.
// One that is already chosen on the task (selectedId), or that already has tasks (alsoIds), is still listed, so nothing already set ever loses its name.
// Names shown on existing tasks come from the full client list and are not affected.
export function taskClientChoices(clients, selectedId, alsoIds) {
  return (clients || []).filter(c => c.show_in_tasks !== false || c.id === selectedId || (alsoIds && alsoIds.has(c.id)))
}
