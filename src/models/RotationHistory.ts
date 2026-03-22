export interface RotationRecord {
  id: number;
  oldKeyId: string;
  newKeyId: string;
  reason: string;
  rotatedBy: string;
  oldKeyValidUntil: string;
  rotatedAt: string;
}

export interface RotationCreate {
  oldKeyId: string;
  newKeyId: string;
  reason: string;
  rotatedBy: string;
  oldKeyValidUntil: string;
}

export interface RotationQuery {
  keyId?: string;
  rotatedBy?: string;
  limit?: number;
  offset?: number;
}
