// The same behavioral contract runs against both real adapter implementations.
export async function storageContract(api) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const month = await api.createMonth(2026, 10, 1, null);
  check(month.id != null && month.income === 0, 'createMonth returns the created period');
  check((await api.createMonth(2026, 10, 1, null)).error === 'exists', 'duplicate period');
  await api.updateMonth(month.id, { income: 1000, saved: 100 });
  const entry = await api.createEntry({ month_id: month.id, type: 'mandatory', category: 'one',
    name: 'Непредвиденные', planned: 300, actual: 20, is_reserve: true });
  await api.updateEntry(entry.id, { name: 'Подушка', planned: 400 });
  let loaded = await api.getMonth(month.id);
  check(loaded.month.income === 1000 && loaded.month.saved === 100, 'updateMonth round trip');
  check(loaded.entries[0].name === 'Подушка' && loaded.entries[0].is_reserve === true, 'reserve survives rename/read');
  const copy = await api.createMonth(2026, 10, 2, month.id);
  const copied = (await api.getMonth(copy.id)).entries[0];
  check(copied.id !== entry.id && copied.month_id === copy.id && copied.actual === 0 && copied.planned === 400 && copied.is_reserve, 'copy plan resets fact and preserves reserve');
  const backlog = await api.entryToBacklog(entry.id);
  check(!(await api.getMonth(month.id)).entries.length, 'move removes source');
  check(backlog.name === 'Подушка' && backlog.planned === 400, 'move returns destination');
  await api.updateBacklog(backlog.id, { name: 'Покупка', planned: 250 });
  check((await api.listBacklog())[0].planned === 250, 'backlog update/read');
  const moved = await api.backlogToEntry(backlog.id, month.id);
  check(moved.type === 'planned' && moved.actual === 0 && moved.month_id === month.id, 'move back creates planned row');
  check(!(await api.listBacklog()).length, 'move back removes source');
  const disposable = await api.createBacklog({ category: 'one', name: 'Удалить', planned: 10 });
  await api.deleteBacklog(disposable.id);
  await api.deleteEntry(moved.id);
  check(!(await api.getMonth(month.id)).entries.length && !(await api.listBacklog()).length, 'delete round trip');
  check((await api.listMonths()).length === 2, 'list periods');
  return { month, copy };
}
