import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// Creates the first admin plus a small demo department: two lecturers, five students
// and two courses. Safe to run more than once.
const db = new PrismaClient();

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@campus.test").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_ADMIN_PASSWORD (10+ characters) in .env before seeding.");
  const hash = await bcrypt.hash(password, 12);

  await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, passwordHash: hash, role: "ADMIN", firstName: "System", lastName: "Administrator" },
  });

  // Demo accounts share the admin's password so they're easy to try out locally.
  const lecturers = [
    { email: "m.phiri@campus.test", firstName: "Mutale", lastName: "Phiri", staffNumber: "STF1001", department: "Computer Science" },
    { email: "c.banda@campus.test", firstName: "Chanda", lastName: "Banda", staffNumber: "STF1002", department: "Computer Science" },
  ];
  const lecturerIds: string[] = [];
  for (const l of lecturers) {
    const user = await db.user.upsert({
      where: { email: l.email },
      update: {},
      create: {
        email: l.email,
        passwordHash: hash,
        role: "LECTURER",
        firstName: l.firstName,
        lastName: l.lastName,
        lecturer: { create: { staffNumber: l.staffNumber, department: l.department } },
      },
      include: { lecturer: true },
    });
    lecturerIds.push(user.lecturer!.id);
  }

  const students = [
    ["Natasha", "Mwila"],
    ["Joseph", "Tembo"],
    ["Grace", "Zulu"],
    ["Daniel", "Lungu"],
    ["Ruth", "Mulenga"],
  ];
  const studentIds: string[] = [];
  for (const [i, [firstName, lastName]] of students.entries()) {
    const user = await db.user.upsert({
      where: { email: `${firstName!.toLowerCase()}.${lastName!.toLowerCase()}@campus.test` },
      update: {},
      create: {
        email: `${firstName!.toLowerCase()}.${lastName!.toLowerCase()}@campus.test`,
        passwordHash: hash,
        role: "STUDENT",
        firstName: firstName!,
        lastName: lastName!,
        student: { create: { studentNumber: `20230000${i + 1}`, programme: "BSc Computer Science", yearOfStudy: 3 } },
      },
      include: { student: true },
    });
    studentIds.push(user.student!.id);
  }

  const courses = [
    { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: lecturerIds[0] },
    { code: "CSC3402", title: "Database Systems", semester: "2026-S2", lecturerId: lecturerIds[1] },
  ];
  for (const c of courses) {
    const course = await db.course.upsert({ where: { code: c.code }, update: {}, create: c });
    await db.enrolment.createMany({
      data: studentIds.map((studentId) => ({ studentId, courseId: course.id })),
      skipDuplicates: true,
    });
  }

  console.log(`Seeded. Sign in as ${adminEmail}; demo lecturers and students use the same password.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
