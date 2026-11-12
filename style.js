// Keep Your Eyes Shut — art style, the "YOU" figure, and story settings.
// These words are added to every picture prompt so every video has the same look.
module.exports = {
  style:
    'dark cinematic 3D render, eerie liminal atmosphere, low-key moody lighting, deep shadows, ' +
    'desaturated cold blue and black colours with one small dim red accent light, light volumetric fog, ' +
    'film grain, unsettling quiet mood, psychological horror, no gore, no text, no letters, no watermark',

  // The viewer ("you") is always shown as the same faceless figure.
  you:
    'YOU: a faceless smooth pale-grey mannequin-like human figure with a plain blank head and no facial features, ' +
    'wearing a dark hoodie and dark trousers',

  // Strange beings are always faceless or hidden, never gory.
  creature:
    'a tall thin faceless shadowy figure, silhouette only, partly hidden in darkness',

  // Where the stories happen. The story writer picks one when no topic is given.

  // Outdoor and rural places got the most views so far (forest, scarecrow, amusement park), so these are picked more often.
  settingsHot: [
    'a rented room where the landlord left rules about the door at the end of the hall',
    'your late aunt\'s flat where she left rules taped inside the kitchen cupboard',
    'grandpa\'s old workshop where he left rules about the locked back room',
    'a house you are sitting for neighbours who left rules about the basement',
    'grandma\'s farm where she left rules about the old scarecrow',
    'a forest ranger station where the previous ranger left rules for the night',
    'a cornfield farmhouse where grandma left rules about the scarecrow',
    'an abandoned amusement park you must close alone at night',
    'a lakeside cabin where the owner left rules about the dock after dark',
    'a roadside gas station in the desert on a night with no other cars',
    'a campground where the host gives you rules about the tree line',
    'an old drive-in cinema where the projectionist leaves rules for the last show',
    'a swamp boat tour where the guide gives you rules before sunset',
    'a mountain cable car that stops in the dark between two stations',
    'a lonely farm during a storm where the farmer leaves a list on the door',
    'an orchard at night where the keeper tells you never to count the trees',
    'a night train through empty countryside where the guard gives you a list'
  ],
  settings: [
    'a night flight where the flight attendant hands you a list of rules',
    'your first night shift alone at a 24-hour gas station on an empty highway',
    'an old hotel where the front desk gives you a card with rules for the 9th floor',
    'a late-night train that stops at a station that is not on the map',
    'babysitting in a big house where the parents leave strict rules on the fridge',
    'a night security job at an empty shopping mall',
    'a road trip where the GPS starts giving you rules instead of directions',
    'a hospital night shift on a floor that was closed years ago',
    'a lighthouse keeper job with a logbook of rules from the last keeper',
    'a camping trip where the ranger warns you about rules for the forest after dark',
    'an elevator in an office building at 3 AM that has an extra floor button',
    'a new apartment where the landlord leaves rules about the neighbour in 4B',
    'a snowed-in mountain cabin with rules carved inside the door',
    'a night bus where the driver tells you never to look at the back seat',
    'a museum night tour with rules about the paintings',
    'a fast-food drive-thru night shift with strange customers after 2 AM',
    'an amusement park after closing with rules for staff who stay late',
    'a library basement archive with rules about the last row of shelves',
    'a farmhouse where grandma leaves rules about the scarecrow',
    'a cruise ship at night with rules about deck 13'
  ]
};
