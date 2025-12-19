export type ApiResponse = {
  message: string;
  success: boolean;
}

export type CardStatus = "draft" | "submitted" | "rendered";

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotateDeg: 0 | 90 | 180 | 270;
};

export type CardPhoto = {
  originalKey?: string;
  width?: number;
  height?: number;
  crop?: CropRect;
  cropKey?: string;
};

export type CardDesign = {
  id: string;
  templateId?: string;
  type?: string;
  teamName?: string;
  position?: string;
  jerseyNumber?: string;
  firstName?: string;
  lastName?: string;
  photographer?: string;
  photo?: CardPhoto;
  status: CardStatus;
  renderKey?: string;
  createdAt: string;
  updatedAt: string;
};
