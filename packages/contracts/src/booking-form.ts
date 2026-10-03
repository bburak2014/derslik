import type {
  BookingBlock,
  BookingSettings,
  BookingWindow,
} from "./booking.ts";

/** Kapalı günün kimliği yalnızca React satırını izler; API'ye gönderilmez. */
export type BookingFormBlock = BookingBlock & { id: string };
export type BookingForm = Omit<BookingSettings, "blocks"> & {
  blocks: BookingFormBlock[];
};
export type BookingFormChange = (form: BookingForm) => BookingForm;

let blockSequence = 0;
/** Ekleme ve silme sonrasında kalan satırların kimlikleri değişmez. */
export const bookingBlockWithId = (block: BookingBlock): BookingFormBlock => ({
  ...block,
  id: `block-${++blockSequence}`,
});

export const toBookingForm = (settings: BookingSettings): BookingForm => ({
  ...settings,
  blocks: settings.blocks.map(bookingBlockWithId),
});

/** Sunucuya yalnızca tarihler gider; kapalı günlerin sırası korunur. */
export const bookingSettingsFromForm = (
  form: BookingForm,
): BookingSettings => ({
  ...form,
  blocks: form.blocks.map(({ from, to }) => ({ from, to })),
});

export const patchBookingWindow = (
  form: BookingForm,
  index: number,
  patch: Partial<BookingWindow>,
): BookingForm => ({
  ...form,
  windows: form.windows.map((window, i) =>
    i === index ? { ...window, ...patch } : window,
  ),
});

export const removeBookingWindow = (
  form: BookingForm,
  index: number,
): BookingForm => ({
  ...form,
  windows: form.windows.filter((_, i) => i !== index),
});

export type BookingEditorState = {
  form: BookingForm | null;
  issues: Record<string, string>;
  error: string;
  stale: boolean;
};
export type BookingEditorAction =
  | { type: "loaded"; form: BookingForm }
  | { type: "edited"; change: BookingFormChange }
  | { type: "invalid"; issues: Record<string, string> }
  | { type: "saving" }
  | { type: "failed"; error: string; stale?: boolean };

export const initialBookingEditorState = (): BookingEditorState => ({
  form: null,
  issues: {},
  error: "",
  stale: false,
});

/** Web ve mobil aynı hata temizleme ve yeniden yükleme davranışını kullanır. */
export function bookingEditorReducer(
  state: BookingEditorState,
  action: BookingEditorAction,
): BookingEditorState {
  switch (action.type) {
    case "loaded":
      return { form: action.form, issues: {}, error: "", stale: false };
    case "edited":
      // Satır değiştiğinde önceki doğrulama hatası başka bir satıra kaymamalı.
      return {
        ...state,
        form: state.form ? action.change(state.form) : null,
        issues: {},
      };
    case "invalid":
      return { ...state, issues: action.issues };
    case "saving":
      return { ...state, error: "" };
    case "failed":
      return {
        ...state,
        error: action.error,
        stale: action.stale ?? state.stale,
      };
  }
}

/** Satır kimlikleri saf reducer'ın dışında, yanıt geldiğinde bir kez üretilir. */
export async function loadBookingForm(
  read: () => Promise<BookingSettings>,
  dispatch: (action: BookingEditorAction) => void,
): Promise<void> {
  try {
    dispatch({ type: "loaded", form: toBookingForm(await read()) });
  } catch (error) {
    dispatch({ type: "failed", error: (error as Error).message });
  }
}
