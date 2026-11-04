interface WalkthroughEventCopy {
  description: string;
  iconName: string;
  registeredDescription: string;
}

// Original sample content, informed by the variety and practical detail of real
// association events. Public copy never contains the group's meeting instructions.
export const walkthroughEventCopy = new Map<string, WalkthroughEventCopy>([
  [
    'Welcome evening',
    {
      iconName: 'group-background-selected',
      description: `<p>New faces, a new city, and far too many names to remember? 👋 Come and spend an easy-going evening with the section. You can arrive on your own: we will help you find a table and introduce you to a few people.</p>
      <p>There is no presentation to sit through and no need to prepare anything. Expect conversations about settling in, favourite places to explore, and the events you would like to try this semester.</p>
      <h3>What is planned?</h3>
      <ul><li>A short welcome and a few games to get conversations started.</li><li>Small groups, with time to move between tables and meet different people.</li><li>A relaxed finish, so you can keep chatting or head home when you need to.</li></ul>
      <h3>Before you come</h3>
      <p>Bring a reusable cup and let us know about dietary requirements when signing up. The optional welcome pack can be selected with your place; you do not need one to take part.</p>`,
      registeredDescription:
        '<p>Come to the welcome table just inside the main entrance and show your ticket. We will introduce you to a table if you do not know anyone yet.</p><p>If you selected a welcome pack, collect it from the same table before leaving. Helpers meet here a little early to arrange the seating and put out the games.</p>',
    },
  ],
  [
    'City walk',
    {
      iconName: 'city',
      description: `<p>Get to know the town beyond the route between your accommodation and campus. We will take a relaxed walk through the centre, pause for the stories behind a few familiar buildings, and share the places we return to for a quiet break.</p>
      <h3>Along the way</h3><ul><li>A mix of well-known sights and quieter side streets.</li><li>Short stops for photos and questions, rather than a race to the next landmark.</li><li>An optional café stop at the end; food and drinks are your own choice.</li></ul>
      <p>Wear comfortable shoes and bring a rain layer. The route is mostly paved, but includes some uneven surfaces. If you need a step-free route or a slower pace, let the organisers know before the walk so we can discuss the plan.</p>`,
      registeredDescription:
        '<p>Meet beside the town hall noticeboard. Look for the section flag and check in with the person holding the attendee list before the walk leaves.</p><p>We finish in the centre rather than returning to the starting point. If you arrive late, wait at the meeting point until you have spoken to an organiser.</p>',
    },
  ],
  [
    'Last-minute city tour',
    {
      iconName: 'munich-cathedral:color',
      description: `<p>A spare afternoon is a good excuse to see a little more of the city. Join a small group for a walk, a few local stories, and time to stop whenever something catches our attention.</p>
      <p>Bring comfortable shoes, a water bottle, and whatever you need for the weather. We will be outside for most of the outing. There is no included meal; a stop for a snack is optional.</p>
      <p><strong>Coming on your own is absolutely fine.</strong> We introduce the group before setting off.</p>`,
      registeredDescription:
        '<p>Our group gathers at the fountain on the square, on the side facing the pedestrian street. Show your ticket before we set off and keep it available if the group splits during a stop.</p>',
    },
  ],
  [
    'Museum visit',
    {
      iconName: 'user-manual',
      description: `<p>Take a break from lectures and look at something from a different angle. We are visiting a local exhibition together, with plenty of room for curious questions and different opinions.</p>
      <h3>How the visit works</h3><ol><li>We check in as a group and get a short introduction.</li><li>Explore at your own pace or stay with a few other participants.</li><li>Meet again afterwards to compare the pieces that stayed with us.</li></ol>
      <p>You do not need to know anything about the subject beforehand. The group conversation will be in English, although some exhibition texts may be in German.</p>
      <h3>Useful to know</h3><p>Bring your student ID and leave large bags at home if possible. Photography rules vary between rooms; follow the signs and ask before taking pictures of other participants. There is an optional coffee stop after the visit.</p>`,
      registeredDescription:
        '<p>Meet outside the museum entrance, beside the poster display. Please wait for the organiser rather than joining the individual visitor queue.</p><p>Keep your student ID and ticket handy. We agree on our regrouping point before going into the exhibition.</p>',
    },
  ],
  [
    'Weekend planning',
    {
      iconName: 'suitcase',
      description: `<p>Help turn the next section outing from a nice idea into a plan we can actually run. This is a hands-on planning session for people who enjoy finding routes, comparing options, or making a group feel welcome.</p>
      <h3>What we will work on</h3><ul><li>A manageable programme with time for breaks and independent exploring.</li><li>Transport options and a clear list of costs to check.</li><li>Small tasks for the organising team, including a backup plan for poor weather.</li></ul>
      <p>No previous organising experience is needed. Bring a laptop if you have one, or just bring your ideas. You can help with one small task without taking responsibility for the whole outing.</p>
      <p>When signing up, tell us what you would like to work on and how much time you can offer. We want a mix of practical skills and perspectives.</p>`,
      registeredDescription:
        '<p>We are using the meeting room upstairs; the entrance is beside reception. The shared agenda will be on the screen when you arrive.</p><p>Bring any transport notes or route ideas you already have. Please avoid making bookings until the group has agreed on the plan and budget.</p>',
    },
  ],
  [
    'Lakeside picnic',
    {
      iconName: 'lake',
      description: `<p>A blanket, something good to eat, and an afternoon with no timetable to rush through. 🌿 Join us by the lake for a picnic and a chance to spend a little more time with the people you have met this semester.</p>
      <p>Come with friends or arrive on your own. We will introduce the group, find a spot together, and make sure there is space for anyone who would rather chat than join a game.</p>
      <h3>The plan for the afternoon</h3><ol><li>A short walk together before we settle down by the water.</li><li>A picnic with time to share stories and swap ideas for future outings.</li><li>Optional card games and an easy walk along the shore. Staying on the blanket is also a perfectly good plan.</li></ol>
      <h3>What to bring</h3><ul><li>Your own lunch or snacks, plus enough water for the afternoon.</li><li>A blanket or something comfortable to sit on.</li><li>A reusable cup, cutlery if needed, and a bag to take your rubbish home.</li><li>A warm layer: it can feel cooler beside the water.</li></ul>
      <p>If you bring food to share, keep its ingredient information available. Nobody has to share food, and we cannot promise that shared dishes are suitable for particular allergies.</p>
      <h3>Weather and guests</h3><p>Check this event page before you leave if the weather looks uncertain. Any guest included on your ticket comes with you and shares your check-in code; there is no separate account to set up for them.</p>`,
      registeredDescription:
        '<h3>Finding the group</h3><p>Meet beside the picnic tables at the north entrance, by the wooden noticeboard. Look for the blue section flag. We walk to our picnic spot together after checking everyone in.</p><p>Have your QR code ready and tell the organiser how many of the people on your ticket have arrived. If a guest is coming later, let us know before the group moves on.</p><h3>Helping with the picnic</h3><p>Organisers bring the shared games and the section flag. Please check that the picnic spot is tidy before the last people leave.</p>',
    },
  ],
  [
    'Board game evening',
    {
      iconName: 'beer',
      description: `<p>Pick a table, learn a game, and meet a few new people. We bring a mix of quick card games, cooperative games, and longer strategy games, so there is something to try even if board games are new to you.</p>
      <p>There is no need to bring a team or memorise the rules. We explain each game before starting and mix tables between rounds. You are welcome to bring a favourite game too.</p>
      <p>Food and drinks are optional and paid for individually. Please keep them away from the game pieces. See you at the tables! 🎲</p>`,
      registeredDescription:
        '<p>Our tables are in the back room, beside the games shelf. Check in before choosing a game so we know who has arrived.</p><p>Please return each game to its box with all its pieces before changing tables.</p>',
    },
  ],
  [
    'Sunday football',
    {
      iconName: 'football2',
      description: `<p>Fancy a game without having to find a whole team first? Join our friendly football session. We will make mixed teams on arrival and rotate players so everyone gets time on the pitch.</p>
      <h3>The session</h3><p>We start with a short warm-up and a simple explanation of the format, then play several shorter games. This is a social session rather than a competitive league: different experience levels are welcome.</p>
      <h3>Bring with you</h3><ul><li>Sports clothing and suitable clean trainers.</li><li>A water bottle and a change of clothes for afterwards.</li><li>Your ticket, ready to show when the group checks in.</li></ul>
      <p>The organisers bring the ball and team bibs. Check your sign-up choice for the participation price; refreshments and travel are not included.</p>
      <p>If you need a break, take one and tell an organiser. Please arrive in time for the team introduction so we can start the games together.</p>`,
      registeredDescription:
        '<p>Meet at the sports hall reception and wait for the organiser before entering the playing area. Outdoor shoes and bags stay off the court.</p><p>Organisers collect the ball and bibs from the equipment desk, then return them after checking the playing area.</p>',
    },
  ],
  [
    'Yesterday’s welcome',
    {
      iconName: 'village',
      description: `<p>An informal welcome for new arrivals and anyone who would like to meet the section. We start with introductions, share a few useful local tips, and leave plenty of time for questions.</p><p>Come as you are. You do not need to know anyone already, and the conversation can move between English and other languages as the group gets to know each other.</p>`,
      registeredDescription:
        '<p>Check in at the welcome desk inside the entrance. Guests stay on the ticket of the person who registered; let the team know if some of your group will arrive later.</p>',
    },
  ],
  [
    'Meet your section',
    {
      iconName: 'group-background-selected',
      description: `<p>Who puts together the trips, answers questions, and makes sure the games and picnic blankets find their way home? Meet the volunteers behind the section and find out where you might like to get involved.</p>
      <h3>People, not a presentation</h3><p>We will introduce the teams in small groups, talk about the kinds of events they enjoy running, and leave time for your questions. There is no expectation that you commit to a role on the day.</p>
      <h3>A few ways to join in</h3><ul><li>Welcome people at an event or help someone who has arrived on their own.</li><li>Bring an idea for an outing, workshop, or regular social evening.</li><li>Help with photos, equipment, planning, or a task that fits the time you have.</li></ul>
      <p>You can also browse <a href="/internal/members-hub">Members Hub</a> to find the current teams and shared resources. If you are not sure where to start, come along and have a conversation.</p>`,
      registeredDescription: '',
    },
  ],
]);
