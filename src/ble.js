import { AntFrameAssembler, DEVICE_INFO_REQUEST, STATUS_REQUEST, bytesToHex } from "./protocol.js";

const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

export class AntBleClient extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.characteristic = null;
    this.pollTimer = null;
    this.assembler = new AntFrameAssembler();
    this.onNotification = this.onNotification.bind(this);
    this.onDisconnected = this.onDisconnected.bind(this);
  }

  get supported() { return Boolean(navigator.bluetooth); }
  get connected() { return Boolean(this.device?.gatt?.connected && this.characteristic); }

  async getKnownDevices() {
    if (!this.supported || typeof navigator.bluetooth.getDevices !== "function") return [];
    return navigator.bluetooth.getDevices();
  }

  async requestDevice() {
    if (!this.supported) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth");
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    });
  }

  async connect(device = this.device) {
    if (!this.supported) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth");
    if (!device) device = await this.requestDevice();
    if (this.device && this.device !== device) this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    this.device = device;
    this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    this.device.addEventListener("gattserverdisconnected", this.onDisconnected);
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener("characteristicvaluechanged", this.onNotification);
    this.emit("connection", { connected: true, name: this.device.name || "ANT BMS" });
    await this.write(DEVICE_INFO_REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await this.poll();
    this.pollTimer = window.setInterval(() => this.poll().catch((error) => this.emit("error", { error })), 1000);
    return this.device;
  }

  async write(bytes) {
    if (!this.characteristic) throw new Error("ยังไม่ได้เชื่อมต่อ BMS");
    this.emit("log", { direction: "TX", hex: bytesToHex(bytes) });
    if (this.characteristic.writeValueWithResponse) await this.characteristic.writeValueWithResponse(bytes);
    else await this.characteristic.writeValue(bytes);
  }

  poll() { return this.write(STATUS_REQUEST); }

  onNotification(event) {
    const view = event.target.value;
    const chunk = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.emit("log", { direction: "RX", hex: bytesToHex(chunk), chunk: true });
    for (const frame of this.assembler.push(chunk)) this.emit("frame", { frame });
  }

  disconnect() { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); else this.onDisconnected(); }

  onDisconnected() {
    window.clearInterval(this.pollTimer); this.pollTimer = null;
    this.characteristic?.removeEventListener("characteristicvaluechanged", this.onNotification);
    this.characteristic = null; this.assembler.reset();
    this.emit("connection", { connected: false, name: this.device?.name || "ANT BMS" });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

export const BLE_UUIDS = { service: SERVICE_UUID, characteristic: CHARACTERISTIC_UUID };
