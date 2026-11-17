export function simulatedLocks(): Pick<LockManager, "request"> {
  const held = new Set<string>();
  return { request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (options.mode !== "exclusive" || options.ifAvailable !== true) throw new Error("O teste exige exclusão sem fila.");
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: "exclusive" } as Lock); }
    finally { held.delete(name); }
  } } as Pick<LockManager, "request">;
}
