import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config";

/** Ciphertext-only blob storage (docs/03 B2 "assets" module). Never stores plaintext. */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.bucket = configService.get("STORAGE_BUCKET", { infer: true });
    const prefix = configService.get("STORAGE_KEY_PREFIX", { infer: true }).replace(/^\/+|\/+$/g, "");
    this.keyPrefix = prefix ? `${prefix}/` : "";
    this.client = new S3Client({
      endpoint: configService.get("STORAGE_ENDPOINT", { infer: true }),
      region: configService.get("STORAGE_REGION", { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: configService.get("STORAGE_ACCESS_KEY", { infer: true }),
        secretAccessKey: configService.get("STORAGE_SECRET_KEY", { infer: true }),
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async putCiphertext(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.keyPrefix + key, Body: body, ContentType: "application/octet-stream" }),
    );
  }

  async getCiphertext(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.keyPrefix + key }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
