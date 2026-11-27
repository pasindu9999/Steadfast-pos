/** The parts of the service worker API the updater uses, driven by hand. */
export class FakeWorker extends EventTarget {
  readonly messages: unknown[] = [];

  constructor(public state: ServiceWorkerState) {
    super();
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  become(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

export class FakeRegistration extends EventTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  checks = 0;
  /** What `update()` does, for failing a check. */
  checkResult: () => Promise<void> = () => Promise.resolve();

  update(): Promise<void> {
    this.checks += 1;
    return this.checkResult();
  }

  /** The browser found a new script and started installing it. */
  find(): FakeWorker {
    const worker = new FakeWorker('installing');
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }

  /** The install finished: the worker waits behind the active one, if there is one. */
  installed(worker: FakeWorker): void {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }

  /** The waiting worker takes over, as after `skipWaiting`. */
  activate(worker: FakeWorker): void {
    const old = this.active;
    this.waiting = null;
    this.active = worker;
    worker.become('activating');
    old?.become('redundant');
    worker.become('activated');
  }

  /** A till that has run this app before. */
  static running(): FakeRegistration {
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('activated');
    return registration;
  }
}

export function fakeContainer(registration: FakeRegistration) {
  const registered: string[] = [];
  return {
    registered,
    register(url: string) {
      registered.push(url);
      return Promise.resolve(registration);
    },
  };
}

export function fakeDocument(visibilityState: DocumentVisibilityState = 'visible') {
  return Object.assign(new EventTarget(), { visibilityState });
}
