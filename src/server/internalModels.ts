import type { Http2Server } from 'http2';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';

export type AnyHttpServer = Http2Server | HttpServer | HttpsServer;
