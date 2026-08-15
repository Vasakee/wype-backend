import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let mockModel: {
    findById: jest.Mock;
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };

  beforeEach(async () => {
    mockModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken('User'), useValue: mockModel },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('normalizes the email before querying', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.findByEmail('John@Doe.com');

      expect(mockModel.findOne).toHaveBeenCalledWith({ email: 'john@doe.com' });
    });
  });

  describe('findByIdentity', () => {
    it('searches by email or phone number', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.findByIdentity('+14155552671');

      expect(mockModel.findOne).toHaveBeenCalledWith({
        $or: [{ email: '+14155552671' }, { phoneNumber: '+14155552671' }],
      });
    });
  });

  describe('findByUsername', () => {
    it('searches by exact username', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.findByUsername('basil.quai');

      expect(mockModel.findOne).toHaveBeenCalledWith({
        username: 'basil.quai',
      });
    });
  });

  describe('linkPhoneNumber', () => {
    it('links the number when no other account holds it', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ phoneNumber: '+1555' }),
      });

      await service.linkPhoneNumber('userId', '+1555');

      expect(mockModel.findOne).toHaveBeenCalledWith({ phoneNumber: '+1555' });
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'userId',
        { phoneNumber: '+1555' },
        { new: true },
      );
    });

    it('rejects when the number belongs to a different account', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'otherId' }),
      });

      await expect(service.linkPhoneNumber('userId', '+1555')).rejects.toThrow(
        ConflictException,
      );
      expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('markEmailVerified', () => {
    it('marks the account email as verified', async () => {
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ isEmailVerified: true }),
      });

      await service.markEmailVerified('userId');

      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'userId',
        { isEmailVerified: true },
        { new: true },
      );
    });
  });

  describe('claimUsername', () => {
    it('normalizes and stores the username with a claimed-at date', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ username: 'basil.quai' }),
      });

      await service.claimUsername('aaaaaaaaaaaaaaaaaaaaaaaa', 'Basil.Quai');

      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      const [id, update, options] = mockModel.findByIdAndUpdate.mock
        .calls[0] as [
        string,
        { username: string; usernameClaimedAt: Date },
        { new: boolean },
      ];
      expect(id).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(update.username).toBe('basil.quai');
      expect(update.usernameClaimedAt).toBeInstanceOf(Date);
      expect(options).toEqual({ new: true });
    });

    it('rejects a username that is already taken', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ username: 'basil.quai' }),
      });

      await expect(
        service.claimUsername('aaaaaaaaaaaaaaaaaaaaaaaa', 'basil.quai'),
      ).rejects.toThrow(ConflictException);
      expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an invalid username format', async () => {
      await expect(
        service.claimUsername('aaaaaaaaaaaaaaaaaaaaaaaa', '..'),
      ).rejects.toThrow('Username must be 3-31 characters');
      expect(mockModel.findOne).not.toHaveBeenCalled();
    });
  });
});
