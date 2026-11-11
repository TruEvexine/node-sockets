(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.createChatAvatar = factory;
    }
}(typeof globalThis === "object" ? globalThis : this, function createChatAvatar(seed = "") {
    const palettes = [
        ["#f3a7c7", "#fff1db", "#a45b78"],
        ["#86d2ec", "#fff1db", "#5289a0"],
        ["#a9d8a1", "#fff1db", "#56805b"],
        ["#b6a4ef", "#fff1db", "#7560a4"],
        ["#ffc27a", "#fff1db", "#a36d38"],
        ["#9eafdc", "#fff1db", "#596e9d"]
    ];
    const accessories = [
        '<path d="M37 33Q64 12 91 33L86 39Q64 27 42 39Z" fill="#e96a69" stroke="#493b59" stroke-width="4"/><path d="M34 38h60" stroke="#493b59" stroke-width="4" stroke-linecap="round"/>',
        '<path d="M43 32Q64 4 85 32l-4 9H47Z" fill="#67b6a4" stroke="#493b59" stroke-width="4"/><path d="M43 32h42" stroke="#493b59" stroke-width="4"/>',
        '<path d="m85 34 3-10 5 9 10 3-10 4-5 9-3-9-9-4Z" fill="#ffcf4f" stroke="#493b59" stroke-width="3"/>',
        '<circle cx="49" cy="65" r="10" fill="none" stroke="#493b59" stroke-width="4"/><circle cx="79" cy="65" r="10" fill="none" stroke="#493b59" stroke-width="4"/><path d="M59 65h10M39 64H32m56 0h8" stroke="#493b59" stroke-width="4" stroke-linecap="round"/>',
        '<path d="M38 91q26 17 52 0v9q-26 16-52 0Z" fill="#e96a69" stroke="#493b59" stroke-width="3"/><circle cx="64" cy="100" r="5" fill="#ffcf4f" stroke="#493b59" stroke-width="2"/>',
        '<path d="M55 92q9-10 18 0-9 10-18 0Zm9-3v6" fill="#f2a4c7" stroke="#493b59" stroke-width="3"/>'
    ];

    let hash = 0;
    for (const character of seed) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    const [background, faceColor, clothes] = palettes[hash % palettes.length];
    const accessory = accessories[Math.floor(hash / palettes.length) % accessories.length];
    const type = Math.floor(hash / (palettes.length * accessories.length)) % 2;
    const ears = type === 0
        ? '<path d="M31 54 24 20l34 23m39 11 7-34-34 23" fill="#fff1db" stroke="#493b59" stroke-width="5" stroke-linejoin="round"/><path d="m35 42-4-13 17 12m45 1 4-13-17 12" fill="#eda2af"/>'
        : '<path d="M39 48C19 26 15 46 23 72c4 13 14 14 23 5m43-29c20-22 24-2 16 24-4 13-14 14-23 5" fill="#fff1db" stroke="#493b59" stroke-width="5" stroke-linecap="round"/><path d="M31 49q-5 6 2 17m64-17q5 6-2 17" fill="none" stroke="#eda2af" stroke-width="5" stroke-linecap="round"/>';
    const face = type === 0
        ? `<ellipse cx="64" cy="67" rx="38" ry="38" fill="${faceColor}" stroke="#493b59" stroke-width="5"/>`
        : `<path d="M30 59Q31 34 64 34t34 25q0 34-18 41H48Q30 93 30 59Z" fill="${faceColor}" stroke="#493b59" stroke-width="5"/><path d="M42 43q22-15 44 0" fill="none" stroke="#ffffff" stroke-width="5" opacity=".85"/>`;
    const muzzle = type === 0
        ? '<ellipse cx="46" cy="78" rx="14" ry="12" fill="#ffffff"/><ellipse cx="82" cy="78" rx="14" ry="12" fill="#ffffff"/><path d="M32 79 17 76m16 10-17 2m95-12-15 3m16 7-17-2" stroke="#75627b" stroke-width="2.5" stroke-linecap="round"/>'
        : '<ellipse cx="52" cy="77" rx="17" ry="14" fill="#ffffff"/><ellipse cx="76" cy="77" rx="17" ry="14" fill="#ffffff"/><path d="M56 70q8-9 16 0-1 8-8 8t-8-8Z" fill="#493b59"/><path d="M64 78v7m0 0c-5 5-9 4-12 1m12-1c5 5 9 4 12 1" fill="none" stroke="#75627b" stroke-width="2.5" stroke-linecap="round"/><path d="M64 87q-2 7 4 8" fill="none" stroke="#ed8194" stroke-width="4" stroke-linecap="round"/>';
    const eyes = type === 0
        ? '<path d="M46 64h3m30 0h3" stroke="#493b59" stroke-width="7" stroke-linecap="round"/>'
        : '<ellipse cx="48" cy="62" rx="4" ry="6" fill="#493b59"/><ellipse cx="80" cy="62" rx="4" ry="6" fill="#493b59"/><path d="m37 53 13-3m41 3-13-3" stroke="#75627b" stroke-width="3" stroke-linecap="round"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${background}"/><path d="M14 128q2-36 32-39h36q30 3 32 39" fill="${clothes}" stroke="#493b59" stroke-width="5"/><path d="M61 95h6v28h-6z" fill="#fff1db" opacity=".8"/><path d="M20 111h88" stroke="#ffffff" stroke-width="3" opacity=".5"/>${ears}${face}${eyes}${muzzle}${type === 0 ? '<path d="m60 77 4 4 4-4z" fill="#ed8194"/><path d="M64 81v5m0 0c-5 5-9 4-12 1m12-1c5 5 9 4 12 1" fill="none" stroke="#75627b" stroke-width="2.5" stroke-linecap="round"/>' : ''}${accessory}</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}));
