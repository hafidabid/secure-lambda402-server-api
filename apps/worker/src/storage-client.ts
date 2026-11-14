import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StorageClient {
  getCiphertext(key: string): Promise<Buffer>;
}

/** Minimal read-only S3/MinIO client. The worker only ever reads ciphertext, never writes it. */
export class S3StorageClient implements StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: true,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async getCiphertext(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
