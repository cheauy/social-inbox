// Keep full and incremental refreshes in arrival order. A failed request must
// not prevent a later reconnect/manual refresh from running.
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    const pending = this.tail.then(task);
    this.tail = pending.catch(() => {});
    return pending;
  }
}
