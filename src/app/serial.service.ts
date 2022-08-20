import { Injectable } from '@angular/core';
import { BehaviorSubject, filter, from, map, Observable, retry, shareReplay, Subject, switchMap, tap } from 'rxjs';

export interface KartData {
  recipient: string;
  rssi: number;
  sender: string;
  snr: number;
  data: {
    altitude: number;
    battery: number;
    course: number;
    hdop: number;
    lat: number;
    lng: number;
    satellites: number;
    speed: number;
    timestamp: Date;
  }
}

export interface KartMessage {
  message: string;
  reciever?: string;
  ack: boolean;
  uuid: string;
  timestamp: Date;
}


@Injectable({
  providedIn: 'root'
})
export class SerialService {

  private port = new Subject<SerialPort | null>();
  private writer = new BehaviorSubject<string | null>(null);

  constructor() {
    navigator.serial.getPorts().then(ports => {
      if (ports.length === 1) {
        this.port.next(ports[0]);
      } else {
        this.port.next(null);
      }
    });
  }

  public selectedPort$ = this.port.asObservable();
  public serialPort$: Observable<KartData> = this.port.pipe(
    filter(x => !!x),
    switchMap(port => fromWebSerial(port, 115200, this.writer.asObservable())),
    map(data => {
      try {
        return JSON.parse(data)
      } catch (error) {
        return null;
      }
    }),
    filter(x => !!x),
    map(jsonData => {
      const kartData = jsonData;
      kartData.data.timestamp = new Date(jsonData.data.timestamp);
      return kartData as KartData;
    }),
    shareReplay()
  );

  public connect(force = false): void {
    if (force) {
      navigator.serial.requestPort().then(selectedPort => this.port.next(selectedPort));
    } else {
      this.port.subscribe(port => {
        if (!port) {
          navigator.serial.requestPort().then(selectedPort => this.port.next(selectedPort));
        }
      });
    }
  }

  public writeMessage(message: KartMessage): void {
    this.writer.next(JSON.stringify(message));
  }
}

function fromWebSerial(port: SerialPort | any, baudRate = 115200, signal: Observable<string | null> | null = null): Observable<any> {
  return new Observable((subscriber) => {
    port.open({ baudRate }).then(async () => {

      const encoder = new TextEncoderStream();
      const outputDone = encoder.readable.pipeTo(port.writable);
      const outputStream = encoder.writable;

      const writer = outputStream.getWriter();

      if (signal) {
        signal.pipe(
          filter(x => !!x),
          switchMap((value) => {
            return writer.write(value as string)
          })
        ).subscribe()
      }
      while (true) {
        const textDecoder = new TextDecoderStream();

        try {
          const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
        } catch (error) {
          subscriber.error(new Error("Pipe is broken"))
        }

        const reader = textDecoder.readable
          .pipeThrough(new TransformStream(new LineBreakTransformer()))
          .getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              // |reader| has been canceled.
              break;
            }
            subscriber.next(value);
            // Do something with |value|...
          }
        } catch (error) {
          subscriber.error(error)
        } finally {
          reader.releaseLock();
          !subscriber.closed && subscriber.complete();
        }
      }
    });

    return async () => {
      await port.close();
    };
  });
}

class LineBreakTransformer {
  chunks: any;

  constructor() {
    // A container for holding stream data until a new line.
    this.chunks = "";
  }

  transform(chunk: any, controller: any) {
    // Append new chunks to existing chunks.
    this.chunks += chunk;
    // For each line breaks in chunks, send the parsed lines out.
    const lines = this.chunks.split("\r\n");
    this.chunks = lines.pop();
    lines.forEach((line: any) => controller.enqueue(line));
  }

  flush(controller: any) {
    // When the stream is closed, flush any remaining chunks out.
    controller.enqueue(this.chunks);
  }
}
