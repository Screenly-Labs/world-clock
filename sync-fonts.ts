#!/usr/bin/env bun
// Vendor this app's webfonts into ./assets/fonts. The files, versions, and copy
// logic all live in @screenly-labs/signage-kit; this just names the families
// the board uses (Fraunces time digits + Hanken Grotesk chrome) and the dest
// dir (this app keeps a relative ../fonts/ layout, not /static/fonts).

import { syncFonts } from '@screenly-labs/signage-kit/sync-fonts'

export const run = (): Promise<number> => syncFonts(['fraunces', 'hanken-grotesk'], 'assets/fonts')

if (import.meta.main) {
  await run()
}
