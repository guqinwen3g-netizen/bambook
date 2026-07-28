/**
 * Lightweight JSON Database (Browser Compatible)
 * Uses localStorage for persistence.
 */
export class JsonDB<T> {
    private key: string;
    private data: T;
    private defaultData: T;

    constructor(filename: string, defaultData: T) {
        // Use filename as the localStorage key
        this.key = `pandaai_db_${filename}`;
        this.defaultData = defaultData;
        this.data = this.load();
    }

    private load(): T {
        if (typeof window === 'undefined') return this.defaultData; // Server-side safety

        try {
            const stored = localStorage.getItem(this.key);
            if (stored) {
                return JSON.parse(stored) as T;
            }
        } catch (e) {
            console.error(`[JsonDB] Error loading ${this.key}, using default.`, e);
        }
        // Deep copy default to avoid reference issues
        return JSON.parse(JSON.stringify(this.defaultData));
    }

    public get(): T {
        return this.data;
    }

    public update(updater: (data: T) => void): void {
        updater(this.data);
        this.save();
    }

    public set(newData: T): void {
        this.data = newData;
        this.save();
    }

    private save(): void {
        if (typeof window === 'undefined') return;

        try {
            localStorage.setItem(this.key, JSON.stringify(this.data));
        } catch (e) {
            console.error(`[JsonDB] Write failed for ${this.key}:`, e);
        }
    }
}

