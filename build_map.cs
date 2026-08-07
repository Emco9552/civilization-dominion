using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class MapBuilder
{
    static int W, H, N;

    static Bitmap Load32(string path, int w, int h)
    {
        using (Bitmap src = new Bitmap(path))
        {
            Bitmap dst = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(dst))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(src, new Rectangle(0, 0, w, h));
            }
            return dst;
        }
    }

    static int[] Pixels(Bitmap b)
    {
        BitmapData d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int[] px = new int[b.Width * b.Height];
        Marshal.Copy(d.Scan0, px, 0, px.Length);
        b.UnlockBits(d);
        return px;
    }

    static void SavePixels(int[] px, int w, int h, string path)
    {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(px, 0, d.Scan0, px.Length);
        b.UnlockBits(d);
        b.Save(path, ImageFormat.Png);
        b.Dispose();
    }

    public static string Run(string dir)
    {
        StringBuilder log = new StringBuilder();

        // Borders.png defines the canvas size; everything else is scaled to it.
        int bw, bh;
        using (Bitmap probe = new Bitmap(Path.Combine(dir, "Borders.png"))) { bw = probe.Width; bh = probe.Height; }
        W = bw; H = bh; N = W * H;

        int[] pb = Pixels(Load32(Path.Combine(dir, "Borders.png"), W, H));
        int[] pr = Pixels(Load32(Path.Combine(dir, "RLmap.png"), W, H));
        int[] pc = Pixels(Load32(Path.Combine(dir, "CoolBorders.png"), W, H));
        int[] ph = Pixels(Load32(Path.Combine(dir, "Human borders.png"), W, H));

        // --- 1. border mask: near-neutral dark stroke pixels ---
        bool[] border = new bool[N];
        for (int i = 0; i < N; i++)
        {
            int c = pb[i];
            int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
            int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
            border[i] = mx < 72 && (mx - mn) < 34;
        }
        // dilate by 1 px to close antialiasing pinholes in the stroke
        bool[] bd = new bool[N];
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x;
                if (border[i]) { bd[i] = true; continue; }
                if ((x > 0 && border[i - 1]) || (x < W - 1 && border[i + 1]) ||
                    (y > 0 && border[i - W]) || (y < H - 1 && border[i + W])) bd[i] = true;
            }
        border = bd;

        // --- 2. flood fill non-border pixels into raw labels ---
        int[] label = new int[N];
        for (int i = 0; i < N; i++) label[i] = -1;
        List<int> rawArea = new List<int>();
        int[] queue = new int[N];
        for (int s = 0; s < N; s++)
        {
            if (border[s] || label[s] >= 0) continue;
            int id = rawArea.Count;
            int head = 0, tail = 0;
            queue[tail++] = s; label[s] = id;
            int area = 0;
            while (head < tail)
            {
                int i = queue[head++]; area++;
                int x = i % W, y = i / W;
                if (x > 0 && !border[i - 1] && label[i - 1] < 0) { label[i - 1] = id; queue[tail++] = i - 1; }
                if (x < W - 1 && !border[i + 1] && label[i + 1] < 0) { label[i + 1] = id; queue[tail++] = i + 1; }
                if (y > 0 && !border[i - W] && label[i - W] < 0) { label[i - W] = id; queue[tail++] = i - W; }
                if (y < H - 1 && !border[i + W] && label[i + W] < 0) { label[i + W] = id; queue[tail++] = i + W; }
            }
            rawArea.Add(area);
        }
        int rawCount = rawArea.Count;

        // --- 3. ocean labels: any raw label touching the image edge ---
        HashSet<int> ocean = new HashSet<int>();
        for (int x = 0; x < W; x++)
        {
            if (label[x] >= 0) ocean.Add(label[x]);
            if (label[(H - 1) * W + x] >= 0) ocean.Add(label[(H - 1) * W + x]);
        }
        for (int y = 0; y < H; y++)
        {
            if (label[y * W] >= 0) ocean.Add(label[y * W]);
            if (label[y * W + W - 1] >= 0) ocean.Add(label[y * W + W - 1]);
        }

        // --- 4. unassign tiny regions (stroke artifacts) so BFS absorbs them ---
        // real small countries are compact cells; stroke slivers are thin — filter by bbox fill ratio
        int[] rMinX = new int[rawCount], rMinY = new int[rawCount], rMaxX = new int[rawCount], rMaxY = new int[rawCount];
        for (int k = 0; k < rawCount; k++) { rMinX[k] = W; rMinY[k] = H; rMaxX[k] = 0; rMaxY[k] = 0; }
        for (int i = 0; i < N; i++)
        {
            int l = label[i]; if (l < 0) continue;
            int x = i % W, y = i / W;
            if (x < rMinX[l]) rMinX[l] = x; if (y < rMinY[l]) rMinY[l] = y;
            if (x > rMaxX[l]) rMaxX[l] = x; if (y > rMaxY[l]) rMaxY[l] = y;
        }
        bool[] drop = new bool[rawCount];
        for (int k = 0; k < rawCount; k++)
        {
            if (ocean.Contains(k)) continue;
            int a = rawArea[k];
            if (a < 110) { drop[k] = true; continue; }
            if (a < 420)
            {
                double rbw = rMaxX[k] - rMinX[k] + 1, rbh = rMaxY[k] - rMinY[k] + 1;
                double fill = a / (rbw * rbh);
                double elong = Math.Max(rbw, rbh) / Math.Min(rbw, rbh);
                if (fill < 0.28 || elong > 5.0) drop[k] = true; // thin sliver between strokes
            }
        }
        int tiny = 0;
        for (int i = 0; i < N; i++)
        {
            int l = label[i];
            if (l >= 0 && !ocean.Contains(l) && drop[l]) { label[i] = -1; tiny++; }
        }

        // --- 5. multi-source BFS: absorb border + tiny pixels into nearest region ---
        {
            int head = 0, tail = 0;
            for (int i = 0; i < N; i++) if (label[i] >= 0) queue[tail++] = i;
            while (head < tail)
            {
                int i = queue[head++];
                int x = i % W, y = i / W;
                int l = label[i];
                if (x > 0 && label[i - 1] < 0) { label[i - 1] = l; queue[tail++] = i - 1; }
                if (x < W - 1 && label[i + 1] < 0) { label[i + 1] = l; queue[tail++] = i + 1; }
                if (y > 0 && label[i - W] < 0) { label[i - W] = l; queue[tail++] = i - W; }
                if (y < H - 1 && label[i + W] < 0) { label[i + W] = l; queue[tail++] = i + W; }
            }
        }

        // --- 6. land classification from RLmap ---
        bool[] land = new bool[N];
        for (int i = 0; i < N; i++)
        {
            int c = pr[i];
            int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
            bool water = b > 110 && (b - r) >= 45 && !(r >= 145 && g >= 175);
            land[i] = !water;
        }

        // --- 7. red "human" outline mask, flood outside from edges ---
        bool[] red = new bool[N];
        for (int i = 0; i < N; i++)
        {
            int c = ph[i];
            int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
            red[i] = r > 140 && (r - g) > 55 && (r - b) > 55;
        }
        bool[] outside = new bool[N];
        {
            int head = 0, tail = 0;
            for (int x = 0; x < W; x++) { int i = x; if (!red[i] && !outside[i]) { outside[i] = true; queue[tail++] = i; } i = (H - 1) * W + x; if (!red[i] && !outside[i]) { outside[i] = true; queue[tail++] = i; } }
            for (int y = 0; y < H; y++) { int i = y * W; if (!red[i] && !outside[i]) { outside[i] = true; queue[tail++] = i; } i = y * W + W - 1; if (!red[i] && !outside[i]) { outside[i] = true; queue[tail++] = i; } }
            while (head < tail)
            {
                int i = queue[head++];
                int x = i % W, y = i / W;
                if (x > 0 && !red[i - 1] && !outside[i - 1]) { outside[i - 1] = true; queue[tail++] = i - 1; }
                if (x < W - 1 && !red[i + 1] && !outside[i + 1]) { outside[i + 1] = true; queue[tail++] = i + 1; }
                if (y > 0 && !red[i - W] && !outside[i - W]) { outside[i - W] = true; queue[tail++] = i - W; }
                if (y < H - 1 && !red[i + W] && !outside[i + W]) { outside[i + W] = true; queue[tail++] = i + W; }
            }
        }

        // --- 8. per-raw-label stats ---
        Dictionary<int, long[]> stats = new Dictionary<int, long[]>(); // landArea, sumX, sumY, insideRed, total, minX, minY, maxX, maxY, sumR, sumG, sumB, snow, sand, green
        for (int i = 0; i < N; i++)
        {
            int l = label[i];
            if (l < 0 || ocean.Contains(l)) continue;
            long[] st;
            if (!stats.TryGetValue(l, out st)) { st = new long[15]; st[5] = W; st[6] = H; stats[l] = st; }
            st[4]++;
            int x = i % W, y = i / W;
            if (x < st[5]) st[5] = x; if (y < st[6]) st[6] = y;
            if (x > st[7]) st[7] = x; if (y > st[8]) st[8] = y;
            if (land[i])
            {
                st[0]++; st[1] += x; st[2] += y;
                if (!outside[i]) st[3]++;
                int cc = pc[i];
                st[9] += (cc >> 16) & 255; st[10] += (cc >> 8) & 255; st[11] += cc & 255;
                int rc = pr[i];
                int rr = (rc >> 16) & 255, rg = (rc >> 8) & 255, rb = rc & 255;
                if (rr > 165 && rg > 170 && rb > 165) st[12]++;
                else if (rr > 150 && rg > 120 && rr > rb + 40) st[13]++;
                else if (rg >= rr && rg > rb) st[14]++;
            }
        }

        // --- 9. drop landless regions to ocean; find human group ---
        List<int> countries = new List<int>();
        foreach (KeyValuePair<int, long[]> kv in stats)
        {
            if (kv.Value[0] < 110) ocean.Add(kv.Key);
            else countries.Add(kv.Key);
        }

        List<int> humanGroup = new List<int>();
        StringBuilder humTable = new StringBuilder();
        List<int> byRedness = new List<int>(countries);
        byRedness.Sort(delegate(int a, int b2)
        {
            double fa = (double)stats[a][3] / stats[a][0];
            double fb = (double)stats[b2][3] / stats[b2][0];
            return fb.CompareTo(fa);
        });
        for (int k = 0; k < Math.Min(12, byRedness.Count); k++)
        {
            int l = byRedness[k];
            double f = (double)stats[l][3] / stats[l][0];
            humTable.AppendFormat("  raw {0}: landArea={1} insideRedFrac={2:0.00}\n", l, stats[l][0], f);
            if (f >= 0.90) humanGroup.Add(l);
        }

        // merge human group into its largest member
        int humanLabel = -1;
        if (humanGroup.Count > 0)
        {
            humanLabel = humanGroup[0];
            foreach (int l in humanGroup) if (stats[l][0] > stats[humanLabel][0]) humanLabel = l;
            if (humanGroup.Count > 1)
            {
                HashSet<int> merge = new HashSet<int>(humanGroup);
                merge.Remove(humanLabel);
                for (int i = 0; i < N; i++) if (merge.Contains(label[i])) label[i] = humanLabel;
                foreach (int l in merge)
                {
                    long[] a = stats[humanLabel], b = stats[l];
                    a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; a[3] += b[3]; a[4] += b[4];
                    if (b[5] < a[5]) a[5] = b[5]; if (b[6] < a[6]) a[6] = b[6];
                    if (b[7] > a[7]) a[7] = b[7]; if (b[8] > a[8]) a[8] = b[8];
                    a[9] += b[9]; a[10] += b[10]; a[11] += b[11];
                    stats.Remove(l); countries.Remove(l);
                }
            }
        }

        // --- 10. final ids: countries sorted by land area desc -> 1..K, ocean = 0 ---
        countries.Sort(delegate(int a, int b2) { return stats[b2][0].CompareTo(stats[a][0]); });
        Dictionary<int, int> idOf = new Dictionary<int, int>();
        for (int k = 0; k < countries.Count; k++) idOf[countries[k]] = k + 1;

        int[] finalId = new int[N];
        for (int i = 0; i < N; i++)
        {
            int l = label[i];
            int id;
            finalId[i] = (l >= 0 && idOf.TryGetValue(l, out id)) ? id : 0;
        }

        // --- 11. adjacency ---
        HashSet<long> pairs = new HashSet<long>();
        bool[] coastal = new bool[countries.Count + 1];
        for (int y = 0; y < H - 1; y++)
            for (int x = 0; x < W - 1; x++)
            {
                int i = y * W + x;
                int a = finalId[i], b = finalId[i + 1], c = finalId[i + W];
                if (a != b) { if (a == 0) coastal[b] = true; else if (b == 0) coastal[a] = true; else pairs.Add((long)Math.Min(a, b) * 100000 + Math.Max(a, b)); }
                if (a != c) { if (a == 0) coastal[c] = true; else if (c == 0) coastal[a] = true; else pairs.Add((long)Math.Min(a, c) * 100000 + Math.Max(a, c)); }
            }
        Dictionary<int, List<int>> neigh = new Dictionary<int, List<int>>();
        for (int k = 1; k <= countries.Count; k++) neigh[k] = new List<int>();
        foreach (long p in pairs)
        {
            int a = (int)(p / 100000), b = (int)(p % 100000);
            neigh[a].Add(b); neigh[b].Add(a);
        }

        // --- 12. label point: land pixel of region nearest its centroid ---
        double[] bestD = new double[countries.Count + 1];
        int[] bestI = new int[countries.Count + 1];
        for (int k = 0; k <= countries.Count; k++) { bestD[k] = double.MaxValue; bestI[k] = -1; }
        double[] cxArr = new double[countries.Count + 1], cyArr = new double[countries.Count + 1];
        for (int k = 0; k < countries.Count; k++)
        {
            long[] st = stats[countries[k]];
            cxArr[k + 1] = (double)st[1] / st[0];
            cyArr[k + 1] = (double)st[2] / st[0];
        }
        for (int i = 0; i < N; i++)
        {
            int id = finalId[i];
            if (id == 0 || !land[i]) continue;
            double dx = i % W - cxArr[id], dy = i / W - cyArr[id];
            double d = dx * dx + dy * dy;
            if (d < bestD[id]) { bestD[id] = d; bestI[id] = i; }
        }

        // --- 13. outputs ---
        // regions.png: R = id & 255, G = id >> 8, B = 255 for land pixels of a country
        int[] outPx = new int[N];
        for (int i = 0; i < N; i++)
        {
            int id = finalId[i];
            int bland = (id > 0 && land[i]) ? 255 : 0;
            outPx[i] = unchecked((int)0xFF000000) | ((id & 255) << 16) | ((id >> 8) << 8) | bland;
        }
        SavePixels(outPx, W, H, Path.Combine(dir, "regions.png"));

        // debug.png: RLmap blended with per-country color on land; borders dark
        int[] dbg = new int[N];
        Random rnd = new Random(7);
        int[] palR = new int[countries.Count + 1], palG = new int[countries.Count + 1], palB = new int[countries.Count + 1];
        for (int k = 1; k <= countries.Count; k++) { palR[k] = 60 + rnd.Next(196); palG[k] = 60 + rnd.Next(196); palB[k] = 60 + rnd.Next(196); }
        for (int i = 0; i < N; i++)
        {
            int c = pr[i];
            int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
            int id = finalId[i];
            if (id > 0 && land[i]) { r = (r + palR[id]) / 2; g = (g + palG[id]) / 2; b = (b + palB[id]) / 2; }
            if (border[i]) { r /= 4; g /= 4; b /= 4; }
            dbg[i] = unchecked((int)0xFF000000) | (r << 16) | (g << 8) | b;
        }
        // mark label points
        for (int k = 1; k <= countries.Count; k++)
        {
            if (bestI[k] < 0) continue;
            int lx = bestI[k] % W, ly = bestI[k] / W;
            for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++)
            {
                int x = lx + dx, y = ly + dy;
                if (x >= 0 && x < W && y >= 0 && y < H) dbg[y * W + x] = unchecked((int)0xFFFF00FF);
            }
        }
        SavePixels(dbg, W, H, Path.Combine(dir, "debug.png"));

        // regions.json
        StringBuilder js = new StringBuilder();
        js.Append("{\"w\":").Append(W).Append(",\"h\":").Append(H).Append(",\"countries\":[");
        for (int k = 0; k < countries.Count; k++)
        {
            int l = countries[k];
            long[] st = stats[l];
            int id = k + 1;
            int lp = bestI[id];
            double f = (double)st[3] / st[0];
            int avgR = (int)(st[9] / st[0]), avgG = (int)(st[10] / st[0]), avgB = (int)(st[11] / st[0]);
            neigh[id].Sort();
            if (k > 0) js.Append(",");
            js.Append("{\"id\":").Append(id)
              .Append(",\"area\":").Append(st[0])
              .Append(",\"bbox\":[").Append(st[5]).Append(",").Append(st[6]).Append(",").Append(st[7]).Append(",").Append(st[8]).Append("]")
              .Append(",\"cx\":").Append(lp % W).Append(",\"cy\":").Append(lp / W)
              .Append(",\"coastal\":").Append(coastal[id] ? "true" : "false")
              .Append(",\"human\":").Append((l == humanLabel) ? "true" : "false")
              .Append(",\"redFrac\":").Append(f.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))
              .Append(",\"color\":[").Append(avgR).Append(",").Append(avgG).Append(",").Append(avgB).Append("]")
              .Append(",\"snow\":").Append(((double)st[12] / st[0]).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))
              .Append(",\"sand\":").Append(((double)st[13] / st[0]).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))
              .Append(",\"green\":").Append(((double)st[14] / st[0]).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))
              .Append(",\"neighbors\":[");
            for (int q = 0; q < neigh[id].Count; q++) { if (q > 0) js.Append(","); js.Append(neigh[id][q]); }
            js.Append("]}");
        }
        js.Append("]}");
        File.WriteAllText(Path.Combine(dir, "regions.json"), js.ToString());

        log.AppendFormat("size {0}x{1}, raw regions {2}, tiny absorbed px {3}\n", W, H, rawCount, tiny);
        log.AppendFormat("countries: {0}, human raw label: {1} (merged {2})\n", countries.Count, humanLabel, humanGroup.Count);
        log.Append("insideRed top:\n").Append(humTable.ToString());
        log.Append("areas: ");
        for (int k = 0; k < countries.Count; k++) log.AppendFormat("{0}:{1} ", k + 1, stats[countries[k]][0]);
        return log.ToString();
    }
}
