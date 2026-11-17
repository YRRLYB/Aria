/** Coalesce repeated writes while retaining an explicit flush for shutdown. */
export function createDebouncedTask(run: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    flush() {
      if (timer === null) return;
      cancel();
      run();
    },
    cancel,
  };
}
