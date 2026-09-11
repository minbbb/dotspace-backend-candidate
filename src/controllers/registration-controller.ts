import { NextFunction, Request, Response } from 'express';
import { UniqueConstraintError } from 'sequelize';
import { Event, Registration, sequelize, User } from '../models';

function registrationJson(registration: Registration) {
  return {
    id: registration.id,
    eventId: registration.eventId,
    userId: registration.userId,
    createdAt: registration.createdAt,
  };
}

export async function registerForEvent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const eventId = req.params.eventId as string;
    const { userId } = req.body as { userId?: string };

    const user = await User.findByPk(userId);
    if (!user) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User was not found' },
      });
      return;
    }

    try {
      const result = await sequelize.transaction(async (t) => {
        const event = await Event.findByPk(eventId, { lock: true, transaction: t });
        if (!event) {
          return { status: 404 as const, body: { error: { code: 'EVENT_NOT_FOUND', message: 'Event was not found' } } };
        }

        if (event.status !== 'OPEN') {
          return { status: 409 as const, body: { error: { code: 'EVENT_CANCELLED', message: 'Event is cancelled' } } };
        }

        const registrationsNow = await Registration.count({ where: { eventId }, transaction: t });
        if (registrationsNow >= event.capacity) {
          return { status: 409 as const, body: { error: { code: 'EVENT_FULL', message: 'There are no free places' } } };
        }

        const sameRegistration = await Registration.findOne({
          where: { eventId, userId: user.id },
          transaction: t,
        });
        if (sameRegistration) {
          return { status: 200 as const, body: { registration: registrationJson(sameRegistration) } };
        }

        const created = await Registration.create({ eventId, userId: user.id }, { transaction: t });
        return { status: 201 as const, body: { registration: registrationJson(created) } };
      });

      res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        const existing = await Registration.findOne({ where: { eventId, userId: user.id } });
        res.status(200).json({ registration: registrationJson(existing!) });
        return;
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
}
