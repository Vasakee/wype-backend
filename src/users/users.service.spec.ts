import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const mockModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
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
    it('searches by email or whatsapp number', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.findByIdentity('+14155552671');

      expect(mockModel.findOne).toHaveBeenCalledWith({
        $or: [{ email: '+14155552671' }, { whatsappNumber: '+14155552671' }],
      });
    });
  });
});
