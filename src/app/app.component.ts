import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, bufferCount, catchError, combineLatest, interval, map, Observable, of, retry, shareReplay, Subject, switchMap, take, takeUntil, timeout, timer, withLatestFrom } from 'rxjs';
import { KartMessage, KartData, SerialService } from './serial.service';
import * as Leaflet from 'leaflet';
import { UUID } from 'angular2-uuid';

Leaflet.Icon.Default.imagePath = 'assets/';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {

  public map!: Leaflet.Map;
  public mapMarkers: Leaflet.Marker[] = [];

  public mapOptions$ = new Observable<Leaflet.MapOptions>();
  public defaultMapOptions: Leaflet.MapOptions = {
    layers: [
      Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      })
    ],
    zoom: 23,
    center: { lat: 28.626137, lng: 79.821603 }
  }

  public selectedPort$: Observable<SerialPort | null>;
  public kartData$: Observable<KartData>;
  public latestTimestamp$: Observable<Date>;
  public secondsSinceLastMessage$: Observable<number>;
  public connected$: Observable<boolean>;
  public newMessage = "";
  public messages = new Map<UUID, KartMessage>();

  private destroy$ = new Subject();

  constructor(private serialService: SerialService) {
    this.selectedPort$ = this.serialService.selectedPort$
    this.kartData$ = this.serialService.serialPort$;
    this.latestTimestamp$ = this.kartData$.pipe(map(data => data.data.timestamp));
    this.secondsSinceLastMessage$ = interval(10).pipe(withLatestFrom(this.latestTimestamp$), map(([_, timestamp]) => (timestamp.getTime() - new Date().getTime()) / 1000));
    this.connected$ = this.kartData$.pipe(map(() => true), timeout(10000), catchError(() => of(false)));
  }
  ngOnDestroy(): void {
    this.destroy$.next(true);
  }

  async ngOnInit(): Promise<void> {
    this.serialService.connect();

    this.mapOptions$ = this.kartData$.pipe(map(kartData => {
      const location = { lat: kartData.data.lat, lng: kartData.data.lng };

      if (this.map) {
        this.mapMarkers[0].setLatLng(location);
        this.map.panTo(location);
      }

      return { ...this.defaultMapOptions, center: location };
    }));
  }

  async connect(): Promise<void> {
    this.serialService.connect(true);
  }

  initMarkers() {
    this.kartData$.pipe(takeUntil(this.destroy$), take(1)).subscribe(kartData => {
      const locationMarker = { position: { lat: kartData.data.lat, lng: kartData.data.lng }, draggable: false };

      const marker = this.generateMarker(locationMarker, 0);
      marker.addTo(this.map).bindPopup(`<b>${locationMarker.position.lat},  ${locationMarker.position.lng}</b>`);
      this.map.panTo(locationMarker.position);
      this.mapMarkers.push(marker)
    });
  }

  generateMarker(data: any, index: number) {
    Leaflet.Marker

    return Leaflet.marker(data.position, { draggable: data.draggable })
      .on('click', (event) => this.markerClicked(event, index))
      .on('dragend', (event) => this.markerDragEnd(event, index));
  }

  onMapReady($event: Leaflet.Map) {
    this.map = $event;
    this.initMarkers();
  }

  mapClicked($event: any) {
    console.log($event.latlng.lat, $event.latlng.lng);
  }

  markerClicked($event: any, index: number) {
    console.log($event.latlng.lat, $event.latlng.lng);
  }

  markerDragEnd($event: any, index: number) {
    console.log($event.target.getLatLng());
  }

  sendMessage(): void {
    if (!this.newMessage) {
      return;
    }

    const message: KartMessage = { ack: false, message: this.newMessage, uuid: UUID.UUID(), timestamp: new Date() };
    this.serialService.writeMessage(message);
    this.messages.set(message.uuid, message);
    this.newMessage = "";
  }

  sortedMessages(): KartMessage[] {
    return Array.from(this.messages.values()).sort((m1, m2) => m2.timestamp.getTime() - m1.timestamp.getTime());
  }
}

