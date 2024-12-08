/* eslint-disable max-classes-per-file */
import type { Logger } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { Packet } from 'socket.io-parser';
import { Decoder, Encoder } from 'socket.io-parser';
import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstuct';

export interface SocketIOParserProps {
  logger: Logger;
}

export class SocketIOParser {
  constructor(props: SocketIOParserProps) {
    const { logger } = props;

    this.Encoder = class CustomEncoder extends Encoder {
      encode(packet: Packet): any[] {
        // console.log('encode start', Object.clone(packet));
        try {
          if (packet.type === 2 && is.array(packet.data)) {
            packet.data[1] = deconstruct(packet.data[1]);
          } else if (packet.type === 3 && is.array(packet.data)) {
            packet.data = deconstruct(packet.data);
          }
        } catch (error) {
          logger.error('Error occurred while deconstructing', { error });
        }
        // console.log('encode end', packet);
        return super.encode(packet);
      }
    };

    this.Decoder = class CustomDecoder extends Decoder {
      on(event: 'decoded', callback: (packet: any) => void) {
        return super.on(event, packet => {
          // console.log('decode start', Object.clone(packet));
          try {
            if (packet.type === 2 && is.array(packet.data)) {
              packet.data[1] = reconstruct(packet.data[1]);
            } else if (packet.type === 3 && is.array(packet.data)) {
              packet.data = [reconstruct(packet.data[0])];
            }
          } catch (error) {
            logger.error('Error occurred while reconstructing', { error });
          }
          // console.log('decode end', packet);
          callback(packet);
        });
      }
    };
  }

  public Encoder: typeof Encoder;
  public Decoder: typeof Decoder;
}
