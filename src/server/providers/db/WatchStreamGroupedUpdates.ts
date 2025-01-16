import type { ChangeStreamDocument } from 'mongodb';

interface Props {
  collectionName: string;
  eventId: string;
  onFlush(events: ChangeStreamDocument[]): void;
  onDestroy(): void;
}

export class WatchStreamGroupedEvents {
  constructor({ collectionName, eventId, onFlush, onDestroy }: Props) {
    this.#timeout = 100;
    this.#events = [];
    this.collectionName = collectionName;
    this.eventId = eventId;
    this.#onFlush = onFlush;
    this.#destroy = onDestroy;
  }

  #timeout: number;
  #events: ChangeStreamDocument[];
  #flushTimer: NodeJS.Timeout | undefined;
  #destroyTimer: NodeJS.Timeout | undefined;
  #destroy: () => void;
  #onFlush: (events: ChangeStreamDocument[]) => void;

  public readonly collectionName: string;
  public readonly eventId: string;

  public add(event: ChangeStreamDocument) {
    this.#stopDestroyTimer();
    this.#events.push(event);
    this.#resetTimer();
  }

  #resetTimer() {
    if (this.#flushTimer != null) clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(() => this.#flush(), this.#timeout);
  }

  #flush() {
    this.#flushTimer = undefined;
    const events = this.#events;
    this.#events = [];
    this.#onFlush(events);
    this.#startDestroyTimer();
  }

  #startDestroyTimer() {
    if (this.#destroyTimer != null) clearTimeout(this.#destroyTimer);
    this.#destroyTimer = setTimeout(() => this.#destroy(), 2000);
  }

  #stopDestroyTimer() {
    if (this.#destroyTimer != null) clearTimeout(this.#destroyTimer);
  }
}