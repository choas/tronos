import { describe, it, expect, beforeEach } from "vitest";
import {
  getEventBus,
  emitFileChanged,
  emitContextChanged,
} from "../src/events/bus";

describe("Event Bus", () => {
  beforeEach(() => {
    const bus = getEventBus();
    bus.clearSubscriptions();
  });

  it("should emit and receive events", () => {
    const bus = getEventBus();
    const received: any[] = [];

    bus.subscribe({ type: "file-changed" }, (evt) => {
      received.push(evt);
    });

    emitFileChanged("/home/user/file.txt", "create");

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("file-changed");
    expect(received[0].payload.path).toBe("/home/user/file.txt");
    expect(received[0].payload.operation).toBe("create");
  });

  it("should filter events by type", () => {
    const bus = getEventBus();
    const received: any[] = [];

    bus.subscribe({ type: "context-changed" }, (evt) => {
      received.push(evt);
    });

    emitFileChanged("/test", "write");
    emitContextChanged("focus");

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("context-changed");
  });

  it("should filter events by path pattern", () => {
    const bus = getEventBus();
    const received: any[] = [];

    bus.subscribe({ type: "file-changed", path: "/home/user/**" }, (evt) => {
      received.push(evt);
    });

    emitFileChanged("/home/user/inbox/msg.txt", "create");
    emitFileChanged("/tmp/other.txt", "create");

    expect(received.length).toBe(1);
    expect(received[0].payload.path).toBe("/home/user/inbox/msg.txt");
  });

  it("should track event history", () => {
    const bus = getEventBus();

    emitFileChanged("/test1", "write");
    emitFileChanged("/test2", "write");

    const history = bus.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("should unsubscribe", () => {
    const bus = getEventBus();
    const received: any[] = [];

    const id = bus.subscribe({ type: "file-changed" }, (evt) => {
      received.push(evt);
    });

    emitFileChanged("/test", "write");
    expect(received.length).toBe(1);

    bus.unsubscribe(id);
    emitFileChanged("/test2", "write");
    expect(received.length).toBe(1);
  });

  it("should list subscriptions", () => {
    const bus = getEventBus();
    bus.subscribe({ type: "file-changed" }, () => {});
    bus.subscribe({ type: "context-changed" }, () => {});

    const subs = bus.getSubscriptions();
    expect(subs.length).toBe(2);
  });
});
